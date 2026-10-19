-- Phase 25: your own pipelines (owner decisions 2026-10-19, ADR-043).
--
-- Until now there were four fixed pipelines, one per product line, whose stages were reference
-- data changed only by migrations (ADR-006). Each agent now keeps their own pipelines:
--
--   pipelines        a named pipeline (e.g. "P&C"), ordered, archived when no longer used
--   stages           its stages, in order: working stages, then exactly one Won and one Lost
--   pipeline_routes  for each product line, the pipeline its new leads go to (one per line)
--
-- The product line stays on every opportunity (renewals, cross-sell, policy term and reports
-- depend on it); the pipeline only says how the deal is worked, so one pipeline can hold several
-- lines. opportunities.pipeline_id is copied from the stage by trigger, like stage_kind, so
-- callers still only supply stage_id.
--
-- Automation keeps its meaning: a new lead is an opportunity created at a pipeline's first
-- stage (position 1); the stage marked is_quote_stage records the quote date; Won and Lost are
-- stage kinds. Every agent starts with today's four pipelines, copied from the old reference
-- stages (kept, read-only, as the template for new agents), and every existing opportunity is
-- moved to the same-named stage of the matching copy. Nothing else about any deal changes.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  position smallint not null check (position > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipelines_id_owner_key unique (id, owner_id)
);
comment on table public.pipelines is
  'Phase 25: an agent''s own sales pipelines. Archived (not deleted) when no longer used.';
create unique index pipelines_owner_name_idx on public.pipelines (owner_id, lower(name)) where archived_at is null;

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  pipeline_id uuid not null,
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  position smallint not null check (position > 0),
  kind public.stage_kind not null,
  -- Entering this stage means the quote was delivered: the quote date is recorded (Phase 23).
  is_quote_stage boolean not null default false,
  -- The built-in stage this one was copied from (null for stages the agent added).
  template_code text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stages_pipeline_fk foreign key (pipeline_id, owner_id)
    references public.pipelines (id, owner_id) on delete restrict,
  constraint stages_quote_active_check check (not is_quote_stage or kind = 'active'),
  -- Target of the composite FK on opportunities (stage, pipeline, kind and owner must match).
  constraint stages_target_key unique (id, pipeline_id, kind, owner_id)
);
comment on table public.stages is
  'Phase 25: the stages of an agent''s pipeline, in order: working stages, then one Won and one Lost.';
create unique index stages_pipeline_position_idx on public.stages (pipeline_id, position) where archived_at is null;
create index stages_owner_idx on public.stages (owner_id);

create table public.pipeline_routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  product_line text not null references public.product_lines (code) on delete restrict,
  pipeline_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_routes_line_key unique (owner_id, product_line),
  constraint pipeline_routes_pipeline_fk foreign key (pipeline_id, owner_id)
    references public.pipelines (id, owner_id) on delete restrict
);
comment on table public.pipeline_routes is
  'Phase 25: for each product line, the pipeline its new leads go to (one pipeline per line).';

comment on table public.pipeline_stages is
  'Built-in stage templates per product line (ADR-006). Since Phase 25 they only seed each agent''s '
  'starting pipelines; opportunities use public.stages. Changed only by migrations.';

do $$
declare t text;
begin
  foreach t in array array['pipelines', 'stages', 'pipeline_routes'] loop
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function crm_private.touch_row()', t);
    execute format('create trigger %1$s_keep_owner before update on public.%1$s for each row execute function crm_private.keep_owner()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function crm_private.write_audit_log()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Access: own rows only, two-step sign-in, no DELETE (archive instead)
-- ---------------------------------------------------------------------------
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.pipeline_routes enable row level security;
revoke all on public.pipelines, public.stages, public.pipeline_routes from anon, authenticated;
grant select on public.pipelines, public.stages, public.pipeline_routes to authenticated;
grant insert (name, position) on public.pipelines to authenticated;
grant update (name, position, archived_at) on public.pipelines to authenticated;
grant insert (pipeline_id, name, position, kind, is_quote_stage) on public.stages to authenticated;
grant update (name, position, is_quote_stage, archived_at) on public.stages to authenticated;
-- Every agent has a route for every line from the start (section 4); routes are only re-pointed.
grant update (pipeline_id) on public.pipeline_routes to authenticated;

do $$
declare t text;
begin
  foreach t in array array['pipelines', 'stages', 'pipeline_routes'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to authenticated using (owner_id = (select auth.uid()))', t);
    if t <> 'pipeline_routes' then
      execute format('create policy %1$s_insert_own on public.%1$s for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    end if;
    execute format('create policy %1$s_update_own on public.%1$s for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy %1$s_require_mfa on public.%1$s as restrictive for all to authenticated '
      'using ((select auth.jwt() ->> ''aal'') = ''aal2'') with check ((select auth.jwt() ->> ''aal'') = ''aal2'')', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rules that keep every pipeline usable (checked at commit, so a whole edit can be made
--    in one transaction): 3 to 12 stages numbered 1..n, at least one working stage, then
--    Won (n-1) and Lost (n); at most 10 pipelines in use; a stage keeps its kind; a stage or
--    pipeline that still holds deals cannot be archived; routes point at pipelines in use.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: it also runs at the commit of a sign-up (starting pipelines are created
-- by the profile trigger), where the session role is Supabase Auth's, not the agent's. It only
-- reads the one pipeline being checked and its owner's pipeline count.
create function crm_private.check_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fired from pipelines (its id) and stages (its pipeline_id).
  pid uuid := (to_jsonb(new) ->> case when tg_table_name = 'pipelines' then 'id' else 'pipeline_id' end)::uuid;
  n integer;
  working integer;
  max_position integer;
  won_position integer;
  lost_position integer;
  won_count integer;
  lost_count integer;
begin
  select count(*), count(*) filter (where s.kind = 'active'), max(s.position),
         max(s.position) filter (where s.kind = 'won'), max(s.position) filter (where s.kind = 'lost'),
         count(*) filter (where s.kind = 'won'), count(*) filter (where s.kind = 'lost')
    into n, working, max_position, won_position, lost_position, won_count, lost_count
  from public.stages s where s.pipeline_id = pid and s.archived_at is null;

  if n < 3 or n > 12 then
    raise exception 'A pipeline has 3 to 12 stages.' using errcode = 'check_violation';
  end if;
  if working < 1 or won_count <> 1 or lost_count <> 1 then
    raise exception 'A pipeline needs at least one working stage, one Won stage and one Lost stage.' using errcode = 'check_violation';
  end if;
  if max_position <> n or won_position <> n - 1 or lost_position <> n then
    raise exception 'Stages are numbered in order, with Won and Lost last.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.pipelines p
      where p.owner_id = (select x.owner_id from public.pipelines x where x.id = pid) and p.archived_at is null) > 10 then
    raise exception 'You can have up to 10 pipelines.' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke all on function crm_private.check_pipeline() from public, anon, authenticated;

create constraint trigger pipelines_valid after insert or update on public.pipelines
  deferrable initially deferred for each row execute function crm_private.check_pipeline();
create constraint trigger stages_valid after insert or update on public.stages
  deferrable initially deferred for each row execute function crm_private.check_pipeline();

create function crm_private.guard_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind or new.pipeline_id is distinct from old.pipeline_id then
    raise exception 'A stage keeps its kind and pipeline.' using errcode = 'check_violation';
  end if;
  if new.archived_at is not null and old.archived_at is null
     and exists (select 1 from public.opportunities o where o.stage_id = old.id) then
    raise exception 'Move the deals out of "%" before removing it.', old.name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function crm_private.guard_stage() from public, anon, authenticated;
create trigger stages_guard before update on public.stages
  for each row execute function crm_private.guard_stage();

create function crm_private.guard_pipeline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    if exists (select 1 from public.pipeline_routes r where r.pipeline_id = old.id) then
      raise exception 'Send its lines to another pipeline before archiving "%".', old.name using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.opportunities o where o.pipeline_id = old.id and o.outcome in ('open', 'nurture')) then
      raise exception 'Move or close the open deals in "%" before archiving it.', old.name using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function crm_private.guard_pipeline() from public, anon, authenticated;
create trigger pipelines_guard before update on public.pipelines
  for each row execute function crm_private.guard_pipeline();

create function crm_private.guard_route()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.pipelines p where p.id = new.pipeline_id and p.archived_at is not null) then
    raise exception 'New leads cannot go to an archived pipeline.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function crm_private.guard_route() from public, anon, authenticated;
create trigger pipeline_routes_guard before insert or update on public.pipeline_routes
  for each row execute function crm_private.guard_route();

-- ---------------------------------------------------------------------------
-- 4. Starting pipelines: today's four, for every agent (existing and new)
-- ---------------------------------------------------------------------------
create function crm_private.insert_default_pipelines(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  pid uuid;
begin
  if exists (select 1 from public.pipelines p where p.owner_id = p_owner) then
    return;
  end if;
  for l in select * from public.product_lines order by sort_order loop
    insert into public.pipelines (owner_id, name, position) values (p_owner, l.name, l.sort_order)
    returning id into pid;
    insert into public.stages (owner_id, pipeline_id, name, position, kind, is_quote_stage, template_code)
    select p_owner, pid, t.name, t.position, t.kind, t.is_quote_stage, t.code
    from public.pipeline_stages t where t.product_line = l.code;
    insert into public.pipeline_routes (owner_id, product_line, pipeline_id) values (p_owner, l.code, pid);
  end loop;
end;
$$;
revoke all on function crm_private.insert_default_pipelines(uuid) from public, anon, authenticated;

create function crm_private.create_default_pipelines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm_private.insert_default_pipelines(new.id);
  return new;
end;
$$;
revoke all on function crm_private.create_default_pipelines() from public, anon, authenticated;
create trigger profiles_default_pipelines after insert on public.profiles
  for each row execute function crm_private.create_default_pipelines();

select crm_private.insert_default_pipelines(p.id) from public.profiles p;

-- ---------------------------------------------------------------------------
-- 5. Opportunities move to the agent's own stages
-- ---------------------------------------------------------------------------
alter table public.opportunities add column pipeline_id uuid;
comment on column public.opportunities.pipeline_id is
  'Phase 25: the pipeline of the current stage (copied from the stage by trigger).';
alter table public.opportunities drop constraint opportunities_stage_fk;

-- The same-named stage in the copy of the opportunity's old pipeline. Only stage_id and
-- pipeline_id change: the quote-date and touch triggers are paused so no date, task or
-- "last updated" changes; the audit log records each move.
alter table public.opportunities disable trigger opportunities_touch;
alter table public.opportunities disable trigger opportunities_default_quote_date;
alter table public.opportunities disable trigger opportunities_a_stage_kind;
update public.opportunities o
set stage_id = s.id, pipeline_id = s.pipeline_id
from public.pipeline_stages t, public.pipeline_routes r, public.stages s
where t.id = o.stage_id
  and r.owner_id = o.owner_id and r.product_line = t.product_line
  and s.pipeline_id = r.pipeline_id and s.template_code = t.code;
alter table public.opportunities enable trigger opportunities_touch;
alter table public.opportunities enable trigger opportunities_default_quote_date;
alter table public.opportunities enable trigger opportunities_a_stage_kind;

do $$
begin
  if exists (select 1 from public.opportunities where pipeline_id is null) then
    raise exception 'Phase 25: some opportunities could not be moved to the new pipelines.';
  end if;
end;
$$;

alter table public.opportunities alter column pipeline_id set not null;
alter table public.opportunities add constraint opportunities_stage_fk
  foreign key (stage_id, pipeline_id, stage_kind, owner_id)
  references public.stages (id, pipeline_id, kind, owner_id) on update restrict on delete restrict;
comment on column public.opportunities.stage_kind is
  'Copy of stages.kind, enforced by composite FK; lets a CHECK keep stage and outcome consistent.';
drop index public.opportunities_owner_board_idx;
create index opportunities_owner_board_idx on public.opportunities (owner_id, pipeline_id, outcome, stage_id);
create index opportunities_stage_idx on public.opportunities (stage_id);

-- Stage kind and pipeline come from the stage (own stages only, through RLS); a deal cannot
-- move into a removed stage.
create or replace function crm_private.opportunity_stage_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s public.stages;
begin
  select * into s from public.stages x where x.id = new.stage_id;
  if not found then
    raise exception 'That stage could not be found.' using errcode = 'foreign_key_violation';
  end if;
  if s.archived_at is not null and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    raise exception 'That stage has been removed.' using errcode = 'check_violation';
  end if;
  new.stage_kind := s.kind;
  new.pipeline_id := s.pipeline_id;
  return new;
end;
$$;

-- Quote date (Phase 23) on the stage the agent marks as the quote stage.
create or replace function crm_private.default_quote_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quote_sent_on is null
     and new.outcome in ('open', 'nurture')
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id)
     and exists (select 1 from public.stages s where s.id = new.stage_id and s.is_quote_stage) then
    new.quote_sent_on := crm_engine.user_today();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Routing helpers (run as the caller; RLS applies)
-- ---------------------------------------------------------------------------
-- The pipeline a line's new leads go to: its route, else the first pipeline in use.
create function crm_engine.route_pipeline(p_line text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select r.pipeline_id from public.pipeline_routes r
     join public.pipelines p on p.id = r.pipeline_id
     where r.owner_id = auth.uid() and r.product_line = p_line and p.archived_at is null),
    (select p.id from public.pipelines p
     where p.owner_id = auth.uid() and p.archived_at is null order by p.position, p.created_at limit 1)
  );
$$;

create function crm_engine.entry_stage(p_line text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.stages s
  where s.pipeline_id = crm_engine.route_pipeline(p_line) and s.archived_at is null and s.kind = 'active'
  order by s.position limit 1;
$$;

create function crm_engine.won_stage(p_line text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.stages s
  where s.pipeline_id = crm_engine.route_pipeline(p_line) and s.archived_at is null and s.kind = 'won';
$$;

revoke all on function crm_engine.route_pipeline(text), crm_engine.entry_stage(text), crm_engine.won_stage(text)
  from public, anon;
grant execute on function crm_engine.route_pipeline(text), crm_engine.entry_stage(text), crm_engine.won_stage(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Saving a pipeline: name, stages (in order) and the lines it receives, in one step
-- ---------------------------------------------------------------------------
-- p_stages: [{ "id": uuid|null, "name": text, "kind": "active"|"won"|"lost", "quote": bool }]
-- in board order. Existing stages keep their kind; stages left out are removed (archived),
-- which fails if they still hold deals. p_lines: the lines whose new leads go here; a line
-- already sent here stays unless it is sent to another pipeline.
create function public.save_pipeline(p_id uuid, p_name text, p_lines text[], p_stages jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  pid uuid := p_id;
  st jsonb;
  i integer := 0;
  kept uuid[] := '{}';
  sid uuid;
  ln text;
begin
  if jsonb_typeof(p_stages) is distinct from 'array' then
    raise exception 'List the stages.' using errcode = '22023';
  end if;
  if pid is null then
    insert into public.pipelines (name, position)
    values (btrim(p_name), coalesce((select max(p.position) from public.pipelines p where p.owner_id = auth.uid()), 0) + 1)
    returning id into pid;
  else
    update public.pipelines p set name = btrim(p_name) where p.id = pid and p.archived_at is null;
    if not found then
      raise exception 'That pipeline could not be found.' using errcode = 'P0002';
    end if;
  end if;

  -- Free the positions, then number the stages in the order given.
  update public.stages s set position = s.position + 100 where s.pipeline_id = pid and s.archived_at is null;
  for st in select * from jsonb_array_elements(p_stages) loop
    i := i + 1;
    if nullif(st ->> 'id', '') is not null then
      update public.stages s
      set name = btrim(st ->> 'name'), position = i,
          is_quote_stage = coalesce((st ->> 'quote')::boolean, false) and s.kind = 'active'
      where s.id = (st ->> 'id')::uuid and s.pipeline_id = pid and s.archived_at is null
      returning s.id into sid;
      if sid is null then
        raise exception 'A stage could not be found. Reload the page and try again.' using errcode = 'P0002';
      end if;
    else
      insert into public.stages (pipeline_id, name, position, kind, is_quote_stage)
      values (pid, btrim(st ->> 'name'), i, (st ->> 'kind')::public.stage_kind,
              coalesce((st ->> 'quote')::boolean, false) and st ->> 'kind' = 'active')
      returning id into sid;
    end if;
    kept := kept || sid;
    sid := null;
  end loop;
  update public.stages s set archived_at = now()
  where s.pipeline_id = pid and s.archived_at is null and not (s.id = any (kept));

  foreach ln in array coalesce(p_lines, '{}') loop
    update public.pipeline_routes r set pipeline_id = pid where r.owner_id = auth.uid() and r.product_line = ln;
    if not found then
      raise exception 'Unknown line: %', ln using errcode = '22023';
    end if;
  end loop;
  return pid;
end;
$$;
comment on function public.save_pipeline(uuid, text, text[], jsonb) is
  'Phase 25: create or update a pipeline, its stages and the lines it receives. SECURITY INVOKER (RLS applies).';
revoke all on function public.save_pipeline(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.save_pipeline(uuid, text, text[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Board and table: filter by pipeline; the stage comes from the agent's own stages
-- ---------------------------------------------------------------------------
drop function public.search_opportunities(text, text, public.opportunity_outcome, uuid, text, text, integer, integer);
create function public.search_opportunities(
  p_query text default '',
  p_product_line text default null,
  p_outcome public.opportunity_outcome default null,
  p_stage_id uuid default null,
  p_closed text default 'all',
  p_sort text default 'updated',
  p_limit integer default 25,
  p_offset integer default 0,
  p_pipeline_id uuid default null
)
returns table (
  id uuid,
  contact_id uuid,
  product_line text,
  pipeline_id uuid,
  stage_id uuid,
  stage_name text,
  stage_position integer,
  stage_kind public.stage_kind,
  outcome public.opportunity_outcome,
  description text,
  quoted_carrier text,
  quote_sent_on date,
  estimated_annual_premium numeric,
  next_action text,
  effective_date date,
  renewal_date date,
  closed_at timestamptz,
  cycle integer,
  created_at timestamptz,
  updated_at timestamptz,
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select o.id, o.contact_id, o.product_line, o.pipeline_id, o.stage_id, s.name, s.position, o.stage_kind, o.outcome,
    o.description, o.quoted_carrier, o.quote_sent_on, o.estimated_annual_premium, o.next_action,
    o.effective_date, o.renewal_date, o.closed_at, o.cycle, o.created_at, o.updated_at,
    c.contact_type, c.first_name, c.last_name, c.business_name
  from public.opportunities o
  join public.contacts c on c.id = o.contact_id
  join public.stages s on s.id = o.stage_id
  cross join params p
  where
    (
      p.q is null
      or concat_ws(' ', c.first_name, c.last_name) ilike p.pattern escape '\'
      or concat_ws(' ', c.last_name, c.first_name) ilike p.pattern escape '\'
      or c.business_name ilike p.pattern escape '\'
      or o.description ilike p.pattern escape '\'
      or o.quoted_carrier ilike p.pattern escape '\'
    )
    and (p_product_line is null or o.product_line = p_product_line)
    and (p_pipeline_id is null or o.pipeline_id = p_pipeline_id)
    and (p_outcome is null or o.outcome = p_outcome)
    and (p_stage_id is null or o.stage_id = p_stage_id)
    and case coalesce(p_closed, 'all')
          when 'none' then o.outcome in ('open', 'nurture')
          -- Board view: everything still being worked, plus won/lost in the last 30 days.
          when 'recent' then o.outcome in ('open', 'nurture') or o.closed_at >= now() - interval '30 days'
          else true
        end
  order by
    case when p_sort = 'name' then
      lower(coalesce(case when c.contact_type = 'business' then c.business_name end, c.last_name, c.first_name, c.business_name, ''))
    end,
    case when p_sort = 'premium' then o.estimated_annual_premium end desc nulls last,
    case when p_sort = 'created' then o.created_at end desc,
    case when p_sort = 'renewal' then o.renewal_date end nulls last,
    o.updated_at desc,
    o.id
  limit least(greatest(coalesce(p_limit, 25), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
comment on function public.search_opportunities is
  'Opportunity board and table (Phase 4; pipeline filter Phase 25). SECURITY INVOKER: RLS limits results to the caller''s own rows.';
revoke all on function public.search_opportunities(text, text, public.opportunity_outcome, uuid, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.search_opportunities(text, text, public.opportunity_outcome, uuid, text, text, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. New leads, imports and automation use the agent's own stages
-- ---------------------------------------------------------------------------
-- Intake (accept and quick intake): new leads start at the first stage of the line's pipeline.
create or replace function crm_engine.intake_apply(
  p_form jsonb,
  p_contact_id uuid,
  p_referred_by uuid,
  p_note text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  f jsonb := crm_engine.intake_clean(p_form);
  today date := crm_engine.user_today();
  cid uuid := p_contact_id;
  ln text;
  cov jsonb;
  renews date;
  opp uuid;
  line_name text;
begin
  if cid is null then
    insert into public.contacts (contact_type, first_name, last_name, email, phone, address_line1, city, state,
      postal_code, preferred_contact_method, lead_source, referred_by_contact_id, notes)
    values ('individual', f ->> 'first_name', f ->> 'last_name', f ->> 'email', f ->> 'phone',
      f ->> 'address_line1', f ->> 'city', f ->> 'state',
      f ->> 'postal_code', (f ->> 'preferred_contact_method')::public.contact_method,
      coalesce(f ->> 'heard_about', 'Intake form'), p_referred_by, p_note)
    returning id into cid;
  else
    -- An existing contact keeps its details; only empty ones are filled. The address moves
    -- as a whole (street, city, state, ZIP) and only when the contact has no street address.
    update public.contacts c set
      email = coalesce(c.email, f ->> 'email'),
      phone = coalesce(c.phone, f ->> 'phone'),
      address_line1 = case when c.address_line1 is null and f ->> 'address_line1' is not null then f ->> 'address_line1' else c.address_line1 end,
      city = case when c.address_line1 is null and f ->> 'address_line1' is not null then f ->> 'city' else c.city end,
      state = case when c.address_line1 is null and f ->> 'address_line1' is not null then f ->> 'state' else c.state end,
      postal_code = case when c.address_line1 is null and f ->> 'address_line1' is not null
                         then coalesce(f ->> 'postal_code', c.postal_code) else coalesce(c.postal_code, f ->> 'postal_code') end,
      preferred_contact_method = coalesce(c.preferred_contact_method, (f ->> 'preferred_contact_method')::public.contact_method),
      lead_source = coalesce(c.lead_source, f ->> 'heard_about'),
      referred_by_contact_id = coalesce(c.referred_by_contact_id, nullif(p_referred_by, c.id)),
      notes = left(concat_ws(e'\n\n', c.notes, p_note), 5000)
    where c.id = cid and c.archived_at is null;
    if not found then
      raise exception 'That contact could not be found (or is archived).' using errcode = 'P0002';
    end if;
  end if;

  insert into public.household_members (contact_id, first_name, last_name, relationship)
  select cid, p ->> 'first_name', p ->> 'last_name', p ->> 'relationship'
  from jsonb_array_elements(f -> 'household') p;

  insert into public.vehicles (contact_id, year, make, model)
  select cid, (v ->> 'year')::smallint, v ->> 'make', v ->> 'model'
  from jsonb_array_elements(f -> 'vehicles') v;

  for ln in select jsonb_array_elements_text(f -> 'lines') loop
    select c into cov from jsonb_array_elements(f -> 'current_coverage') c where c ->> 'line' = ln;
    renews := crm_engine.next_month_start((cov ->> 'renews_month')::integer, today);
    -- First stage of the pipeline this line routes to (Phase 25).
    insert into public.opportunities (contact_id, product_line, stage_id, current_carrier, current_policy_renews_on)
    values (cid, ln, crm_engine.entry_stage(ln), cov ->> 'carrier', renews)
    returning id into opp;
    if renews is not null then
      select p.name into line_name from public.product_lines p where p.code = ln;
      insert into public.tasks (contact_id, opportunity_id, title, description, due_date, category)
      values (cid, opp, 'Quote ' || line_name || ' before the current policy renews',
        'Current policy renews ' || to_char(renews, 'FMMonth YYYY')
          || coalesce(' with ' || (cov ->> 'carrier'), '') || '.',
        greatest(today, renews - 30), 'prospecting');
    end if;
  end loop;
  return cid;
end;
$$;

-- Import: policies are filed under the Won stage of the line's pipeline.
create or replace function public.import_book(p_file_name text, p_contacts jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  batch uuid;
  today date := crm_engine.user_today();
  item jsonb;
  c jsonb;
  p jsonb;
  cid uuid;
  created integer := 0;
  matched integer := 0;
  policies integer := 0;
  renews date;
  effective date;
  term integer;
  won_stage uuid;
begin
  if jsonb_typeof(p_contacts) is distinct from 'array' or jsonb_array_length(p_contacts) = 0 then
    raise exception 'Nothing to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) > 1000 then
    raise exception 'Import at most 1,000 clients at a time.' using errcode = '22023';
  end if;
  insert into public.import_batches (file_name) values (left(coalesce(nullif(btrim(p_file_name), ''), 'import.csv'), 200))
  returning id into batch;

  for item in select * from jsonb_array_elements(p_contacts) loop
    c := item -> 'contact';
    if nullif(item ->> 'existing_contact_id', '') is not null then
      -- Policies for a contact the user matched: the contact itself is left as it is.
      select x.id into cid from public.contacts x
      where x.id = (item ->> 'existing_contact_id')::uuid and x.archived_at is null;
      if cid is null then
        raise exception 'A matched contact could not be found (or is archived).' using errcode = 'P0002';
      end if;
      matched := matched + 1;
    else
      insert into public.contacts (contact_type, first_name, last_name, business_name, email, phone, alt_phone,
        address_line1, city, state, postal_code, lead_source, relationship_status, import_batch_id)
      values (coalesce(c ->> 'contact_type', 'individual')::public.contact_type,
        nullif(btrim(c ->> 'first_name'), ''), nullif(btrim(c ->> 'last_name'), ''), nullif(btrim(c ->> 'business_name'), ''),
        lower(nullif(btrim(c ->> 'email'), '')), nullif(btrim(c ->> 'phone'), ''), nullif(btrim(c ->> 'alt_phone'), ''),
        nullif(btrim(c ->> 'address_line1'), ''), nullif(btrim(c ->> 'city'), ''), upper(nullif(btrim(c ->> 'state'), '')),
        nullif(btrim(c ->> 'postal_code'), ''), coalesce(nullif(btrim(c ->> 'lead_source'), ''), 'Imported'),
        case when jsonb_array_length(coalesce(item -> 'policies', '[]'::jsonb)) > 0 then 'client' else 'prospect' end::public.relationship_status,
        batch)
      returning id into cid;
      created := created + 1;
    end if;

    for p in select * from jsonb_array_elements(coalesce(item -> 'policies', '[]'::jsonb)) loop
      -- The Won stage of the pipeline this line routes to (Phase 25).
      if not exists (select 1 from public.product_lines l where l.code = p ->> 'line') then
        raise exception 'Unknown line: %', p ->> 'line' using errcode = '22023';
      end if;
      won_stage := crm_engine.won_stage(p ->> 'line');
      if won_stage is null then
        raise exception 'Unknown line: %', p ->> 'line' using errcode = '22023';
      end if;
      term := case when p ->> 'line' = 'auto' and (p ->> 'term_months') = '6' then 6 else 12 end;
      effective := nullif(p ->> 'effective_date', '')::date;
      renews := nullif(p ->> 'renewal_date', '')::date;
      -- A renewal date already passed has renewed since: move it to the next one.
      while renews is not null and renews < today loop
        renews := (renews + make_interval(months => term))::date;
      end loop;
      if renews is not null and effective is not null and renews <= effective then
        effective := null;
      end if;
      insert into public.opportunities (contact_id, product_line, stage_id, outcome, quoted_carrier,
        estimated_annual_premium, effective_date, renewal_date, policy_term_months, closed_at, import_batch_id)
      values (cid, p ->> 'line', won_stage, 'won', nullif(btrim(p ->> 'carrier'), ''),
        nullif(p ->> 'premium', '')::numeric, effective, renews, term,
        coalesce(effective, (renews - make_interval(months => term))::date, today)::timestamp at time zone 'America/New_York',
        batch);
      policies := policies + 1;
    end loop;
  end loop;

  -- Renewal reviews the automation created with a date already passed are due today instead
  -- (an import should not start with a wall of overdue tasks).
  update public.tasks t set due_date = today
  where t.status = 'open' and t.due_date < today
    and t.opportunity_id in (select o.id from public.opportunities o where o.import_batch_id = batch);
  -- Keep start dates consistent with the new due date.
  update public.tasks t set start_date = null
  where t.status = 'open' and t.start_date > t.due_date
    and t.opportunity_id in (select o.id from public.opportunities o where o.import_batch_id = batch);

  update public.import_batches set contacts_created = created, contacts_matched = matched, policies_created = policies
  where id = batch;
  return jsonb_build_object('batch_id', batch, 'contacts_created', created, 'contacts_matched', matched, 'policies_created', policies);
end;
$$;

-- Automation: unchanged except that the first stage is read from the agent's own stages.
create or replace function crm_private.opportunity_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := crm_engine.user_today();
  k text := 'opp:' || new.id || ':rule:';
  first_stage boolean;
  period text;
begin
  if tg_op = 'INSERT' then
    -- New lead: only when the opportunity starts at the first stage of its pipeline (Phase 25:
    -- the agent's own pipelines; active stages are numbered from 1).
    select s.position = 1 into first_stage from public.stages s where s.id = new.stage_id;
    if new.outcome in ('open', 'nurture') and coalesce(first_stage, false) then
      perform crm_engine.apply_rule('new_lead_initial_contact', new.contact_id, new.id, today,
        k || 'new_lead_initial_contact:cycle:' || new.cycle);
    end if;
  elsif new.outcome = 'won' and old.outcome <> 'won' then
    if crm_engine.rule_enabled('won_close_prospecting') then
      perform crm_engine.close_prospecting(new.id);
    end if;
    perform crm_engine.apply_rule('won_onboarding_checklist', new.contact_id, new.id, today,
      k || 'won_onboarding_checklist:cycle:' || new.cycle);
    -- One review and one referral request per contact (cooldown on the rule), ADR-013.
    perform crm_engine.apply_rule('review_request', new.contact_id, new.id, today,
      'contact:' || new.contact_id || ':rule:review_request:opp:' || new.id || ':cycle:' || new.cycle);
    perform crm_engine.apply_rule('referral_request', new.contact_id, new.id, today,
      'contact:' || new.contact_id || ':rule:referral_request:opp:' || new.id || ':cycle:' || new.cycle);
  elsif new.outcome = 'lost' and old.outcome <> 'lost' then
    if crm_engine.rule_enabled('lost_close_prospecting') then
      perform crm_engine.close_prospecting(new.id);
    end if;
  elsif new.cycle > old.cycle then
    perform crm_engine.apply_rule('reopened_restart', new.contact_id, new.id, today,
      k || 'reopened_restart:cycle:' || new.cycle);
  end if;

  -- Quote sent (or its date corrected) while the opportunity is still being worked.
  if new.quote_sent_on is not null and new.outcome in ('open', 'nurture')
     and (tg_op = 'INSERT' or new.quote_sent_on is distinct from old.quote_sent_on) then
    perform crm_engine.apply_rule('quote_sent_follow_up', new.contact_id, new.id, new.quote_sent_on,
      k || 'quote_sent_follow_up:cycle:' || new.cycle);
  end if;

  -- Renewal date known or changed (including the roll-forward after a renewal outcome):
  -- one review per renewal period. An ended policy gets none.
  if new.renewal_date is not null and new.policy_ended_on is null
     and (tg_op = 'INSERT' or new.renewal_date is distinct from old.renewal_date) then
    period := extract(year from new.renewal_date)::integer::text;
    if new.policy_term_months = 6 then
      period := period || '-h' || case when extract(month from new.renewal_date) <= 6 then '1' else '2' end;
    end if;
    perform crm_engine.apply_rule('renewal_review', new.contact_id, new.id, new.renewal_date,
      k || 'renewal_review:renewal:' || period);
  end if;
  return null;
end;
$$;

-- Reports: the open pipeline is grouped by the agent's pipelines and stages.
create or replace function public.report_summary(p_start date, p_end date, p_today date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := coalesce((select p.time_zone from public.profiles p where p.id = auth.uid()), 'America/New_York');
begin
  if p_start is null or p_end is null or p_today is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'Choose a period of up to two years.' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'today', p_today),

    -- 1. Open pipeline now: open and nurture opportunities by pipeline and stage (Phase 25: the
    --    agent's own pipelines; a stage is counted under the pipeline it belongs to).
    'open_pipeline', coalesce((
      select jsonb_agg(row_to_json(x) order by x.pipeline_position, x.pipeline_name, x.stage_position)
      from (
        select pl.id as pipeline_id, pl.name as pipeline_name, pl.position as pipeline_position,
          s.name as stage_name, s.position as stage_position,
          count(*) filter (where o.outcome = 'open') as open_count,
          count(*) filter (where o.outcome = 'nurture') as nurture_count,
          coalesce(sum(o.estimated_annual_premium), 0) as premium,
          count(o.estimated_annual_premium) as with_premium
        from public.opportunities o
        join public.stages s on s.id = o.stage_id
        join public.pipelines pl on pl.id = o.pipeline_id
        where o.outcome in ('open', 'nurture')
        group by pl.id, pl.name, pl.position, s.id, s.name, s.position
      ) x
    ), '[]'::jsonb),

    -- 2. New leads by source: contacts added in the period, grouped by lead source
    --    (case-insensitive; first spelling used), with how many have any opportunity and
    --    how many have a won one (as of now).
    'new_leads', coalesce((
      select jsonb_agg(row_to_json(x) order by x.contacts desc, x.source nulls last)
      from (
        select (array_agg(nullif(btrim(c.lead_source), '') order by c.created_at, c.id))[1] as source,
          count(*) as contacts,
          count(*) filter (where exists (select 1 from public.opportunities o where o.contact_id = c.id)) as with_opportunity,
          count(*) filter (where exists (select 1 from public.opportunities o where o.contact_id = c.id and o.outcome = 'won')) as won
        from public.contacts c
        where (c.created_at at time zone tz)::date between p_start and p_end and c.import_batch_id is null
          and not exists (select 1 from public.opportunities x where x.contact_id = c.id and x.existing_policy)
        group by lower(nullif(btrim(c.lead_source), ''))
      ) x
    ), '[]'::jsonb),

    -- 3. Quotes sent in the period (quote date), by line, with where they stand now.
    'quotes', coalesce((
      select jsonb_agg(row_to_json(x) order by x.product_line)
      from (
        select o.product_line,
          count(*) as quoted,
          count(*) filter (where o.outcome = 'open') as open_count,
          count(*) filter (where o.outcome = 'nurture') as nurture_count,
          count(*) filter (where o.outcome = 'won') as won,
          count(*) filter (where o.outcome = 'lost') as lost,
          coalesce(sum(o.estimated_annual_premium), 0) as premium,
          count(o.estimated_annual_premium) as with_premium
        from public.opportunities o
        where o.quote_sent_on between p_start and p_end
        group by o.product_line
      ) x
    ), '[]'::jsonb),

    -- 4. Conversion: opportunities closed (won or lost) in the period, by line. Open ones
    --    are excluded; the app shows won ÷ (won + lost) with the denominator.
    'conversion', coalesce((
      select jsonb_agg(row_to_json(x) order by x.product_line)
      from (
        select o.product_line,
          count(*) filter (where o.outcome = 'won') as won,
          count(*) filter (where o.outcome = 'lost') as lost,
          coalesce(sum(o.estimated_annual_premium) filter (where o.outcome = 'won'), 0) as won_premium,
          count(o.estimated_annual_premium) filter (where o.outcome = 'won') as won_with_premium
        from public.opportunities o
        where o.outcome in ('won', 'lost') and (o.closed_at at time zone tz)::date between p_start and p_end
          and o.import_batch_id is null and not o.existing_policy
        group by o.product_line
      ) x
    ), '[]'::jsonb),

    -- 5. Tasks: completed in the period (on time = completed on or before the due date) and
    --    open tasks overdue today.
    'tasks', (
      select jsonb_build_object(
        'completed', count(*) filter (where t.status = 'completed' and (t.completed_at at time zone tz)::date between p_start and p_end),
        'completed_on_time', count(*) filter (where t.status = 'completed' and (t.completed_at at time zone tz)::date between p_start and p_end
                                                and (t.completed_at at time zone tz)::date <= t.due_date),
        'completed_late', count(*) filter (where t.status = 'completed' and (t.completed_at at time zone tz)::date between p_start and p_end
                                             and (t.completed_at at time zone tz)::date > t.due_date),
        'overdue_now', count(*) filter (where t.status = 'open' and t.due_date < p_today)
      )
      from public.tasks t
    ),

    -- 6. Renewals: open renewal reviews by when they are due, active policies renewing in
    --    the next 90 days, and outcomes recorded in the period.
    'renewals', jsonb_build_object(
      'reviews_overdue', (select count(*) from public.tasks t where t.status = 'open' and t.category = 'renewal' and t.due_date < p_today),
      'reviews_next_30', (select count(*) from public.tasks t where t.status = 'open' and t.category = 'renewal' and t.due_date between p_today and p_today + 30),
      'reviews_31_60', (select count(*) from public.tasks t where t.status = 'open' and t.category = 'renewal' and t.due_date between p_today + 31 and p_today + 60),
      'policies_next_90', (select count(*) from public.opportunities o
                            where o.outcome = 'won' and o.policy_ended_on is null and o.renewal_date between p_today and p_today + 90),
      'outcomes', (
        select jsonb_build_object(
          'renewed', count(*) filter (where r.outcome = 'renewed'),
          'remarketed', count(*) filter (where r.outcome = 'remarketed'),
          'lost', count(*) filter (where r.outcome = 'lost')
        )
        from public.renewal_outcomes r
        where r.recorded_on between p_start and p_end
      )
    ),

    -- 7. Cross-sell: current review prompts by rule (same matching as the prompt lists),
    --    and prompts dismissed in the period.
    'cross_sell', jsonb_build_object(
      'by_rule', coalesce((
        select jsonb_agg(row_to_json(x) order by x.prompts desc, x.rule_name)
        from (
          select m.rule_name, m.lacks_line, count(*) as prompts
          from crm_engine.cross_sell_matches(p_today) m
          group by m.rule_id, m.rule_name, m.lacks_line
        ) x
      ), '[]'::jsonb),
      'dismissed', (select count(*) from public.cross_sell_dismissals d where d.dismissed_on between p_start and p_end)
    ),

    -- 8. Referral sources: who referred the contacts added in the period, and how those
    --    referred contacts are doing (won = has a won opportunity; working = has an open or
    --    nurture one and none won).
    'referrals', coalesce((
      select jsonb_agg(row_to_json(x) order by x.referred desc, x.referrer_id)
      from (
        select ref.id as referrer_id, ref.contact_type, ref.first_name, ref.last_name, ref.business_name,
          count(*) as referred,
          count(*) filter (where exists (select 1 from public.opportunities o where o.contact_id = c.id and o.outcome = 'won')) as won,
          count(*) filter (where not exists (select 1 from public.opportunities o where o.contact_id = c.id and o.outcome = 'won')
                             and exists (select 1 from public.opportunities o where o.contact_id = c.id and o.outcome in ('open', 'nurture'))) as working
        from public.contacts c
        join public.contacts ref on ref.id = c.referred_by_contact_id
        where (c.created_at at time zone tz)::date between p_start and p_end and c.import_batch_id is null
          and not exists (select 1 from public.opportunities x where x.contact_id = c.id and x.existing_policy)
        group by ref.id, ref.contact_type, ref.first_name, ref.last_name, ref.business_name
        order by count(*) desc, ref.id
        limit 25
      ) x
    ), '[]'::jsonb),

    -- 9. Reviews and referrals: clients asked in the period (each counted once, whether
    --    asked through a completed request task or a logged request activity), reviews
    --    recorded (date left), and referrals received (new contacts added with a referrer).
    'asks', jsonb_build_object(
      'review_asked', (
        select count(distinct x.contact_id) from (
          select t.contact_id from public.tasks t
          where t.category = 'review_request' and t.status = 'completed' and (t.completed_at at time zone tz)::date between p_start and p_end
          union all
          select a.contact_id from public.activities a
          where a.activity_type = 'review_request' and (a.occurred_at at time zone tz)::date between p_start and p_end
        ) x
      ),
      'reviews_recorded', (select count(*) from public.contacts c where c.google_review_left_on between p_start and p_end),
      'referral_asked', (
        select count(distinct x.contact_id) from (
          select t.contact_id from public.tasks t
          where t.category = 'referral_request' and t.status = 'completed' and (t.completed_at at time zone tz)::date between p_start and p_end
          union all
          select a.contact_id from public.activities a
          where a.activity_type = 'referral_request' and (a.occurred_at at time zone tz)::date between p_start and p_end
        ) x
      ),
      'referrals_received', (
        select count(*) from public.contacts c
        where c.referred_by_contact_id is not null and (c.created_at at time zone tz)::date between p_start and p_end
          and c.import_batch_id is null
          and not exists (select 1 from public.opportunities x where x.contact_id = c.id and x.existing_policy)
      )
    )
  );
end;
$$;
