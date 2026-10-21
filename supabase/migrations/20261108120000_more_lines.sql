-- Phase 30 (ADR-048): more lines of business (owner request 2026-10-20; choices: nine new lines,
-- each joins the pipeline of a related line, the quote form offers them, header colours unchanged).
--
-- 1. Nine lines: Motorcycle, Boat, RV (with Auto); Renters, Condo, Mobile Home, Umbrella (with
--    Home); Commercial Auto, Farm (with Commercial). product_lines.pipeline_line records which
--    starting pipeline a line joins; the four original lines join their own.
-- 2. Every agent's new lines go to the pipeline their related line goes to today; new agents get
--    the same. Agents can still change any line's pipeline in Settings → Pipelines.
-- 3. A 6-month term is allowed on Auto and Motorcycle (was Auto only).
-- 4. A quote request may ask for any of the lines (was at most 4).
-- 5. Cross-sell rules may name any of the lines (the list of 13 is written in the constraint).
-- The list of 6-month lines is written in three places below (constraint, lifecycle trigger,
-- import) and in src/lib/pipelines.ts SIX_MONTH_LINES; tests/db/more-lines.test.ts checks them.

-- ---------------------------------------------------------------------------
-- 1. The lines
-- ---------------------------------------------------------------------------
alter table public.product_lines add column pipeline_line text references public.product_lines (code) on delete restrict;
comment on column public.product_lines.pipeline_line is
  'Phase 30: the starting pipeline this line joins (its own code for Auto, Home, Commercial and Life).';
update public.product_lines set pipeline_line = code;

-- Grouped display order: each family together.
update public.product_lines set sort_order = sort_order + 100;
update public.product_lines set sort_order = case code when 'auto' then 1 when 'home' then 5 when 'commercial' then 10 when 'life' then 13 end;

insert into public.product_lines (code, name, sort_order, pipeline_line) values
  ('motorcycle', 'Motorcycle', 2, 'auto'),
  ('boat', 'Boat', 3, 'auto'),
  ('rv', 'RV', 4, 'auto'),
  ('renters', 'Renters', 6, 'home'),
  ('condo', 'Condo', 7, 'home'),
  ('mobile_home', 'Mobile Home', 8, 'home'),
  ('umbrella', 'Umbrella', 9, 'home'),
  ('commercial_auto', 'Commercial Auto', 11, 'commercial'),
  ('farm', 'Farm', 12, 'commercial');

alter table public.product_lines alter column pipeline_line set not null;

-- ---------------------------------------------------------------------------
-- 2. Routes: new lines follow their related line's pipeline
-- ---------------------------------------------------------------------------
insert into public.pipeline_routes (owner_id, product_line, pipeline_id)
select r.owner_id, l.code, r.pipeline_id
from public.product_lines l
join public.pipeline_routes r on r.product_line = l.pipeline_line
where l.code <> l.pipeline_line
on conflict (owner_id, product_line) do nothing;

create or replace function crm_private.insert_default_pipelines(p_owner uuid)
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
  -- One pipeline per starting line (Auto, Home, Commercial, Life)...
  for l in select * from public.product_lines where code = pipeline_line order by sort_order loop
    insert into public.pipelines (owner_id, name, position) values (p_owner, l.name, l.sort_order)
    returning id into pid;
    insert into public.stages (owner_id, pipeline_id, name, position, kind, is_quote_stage, template_code)
    select p_owner, pid, t.name, t.position, t.kind, t.is_quote_stage, t.code
    from public.pipeline_stages t where t.product_line = l.code;
    insert into public.pipeline_routes (owner_id, product_line, pipeline_id) values (p_owner, l.code, pid);
  end loop;
  -- ...and every other line joins its related line's pipeline (Phase 30).
  insert into public.pipeline_routes (owner_id, product_line, pipeline_id)
  select p_owner, x.code, r.pipeline_id
  from public.product_lines x
  join public.pipeline_routes r on r.owner_id = p_owner and r.product_line = x.pipeline_line
  where x.code <> x.pipeline_line;
end;
$$;
revoke all on function crm_private.insert_default_pipelines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 6-month terms: Auto and Motorcycle
-- ---------------------------------------------------------------------------
alter table public.opportunities drop constraint opportunities_policy_term_check;
alter table public.opportunities add constraint opportunities_policy_term_check check (
  policy_term_months = 12 or (policy_term_months = 6 and product_line in ('auto', 'motorcycle'))
);
comment on column public.opportunities.policy_term_months is
  'Months between renewals: 12, or 6 for auto and motorcycle. Used to roll the renewal date forward.';

-- Lifecycle trigger from 20261107120000; only the 6-month line list changes.
create or replace function crm_private.opportunity_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.cycle := 1;
    return new;
  end if;

  -- Phase 29: a corrected line drops what only the old line allowed.
  if new.product_line is distinct from old.product_line then
    if new.product_line not in ('auto', 'motorcycle') then
      new.policy_term_months := 12;
    end if;
    if new.product_line <> 'life' then
      new.life_policy_type := null;
      new.premium_mode := null;
      new.first_payout_on := null;
      new.commission_rate_override := null;
    end if;
  end if;

  if old.outcome in ('won', 'lost') and new.outcome in ('open', 'nurture') then
    new.cycle := old.cycle + 1;
  else
    new.cycle := old.cycle;
  end if;

  if old.outcome = 'lost' and new.outcome <> 'lost' then
    new.loss_reason := null;
    new.loss_reason_detail := null;
  end if;

  if new.outcome <> 'won' then
    new.policy_ended_on := null;
  end if;
  return new;
end;
$$;

-- Import from 20261102120000; only the 6-month line list changes.
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
      term := case when p ->> 'line' in ('auto', 'motorcycle') and (p ->> 'term_months') = '6' then 6 else 12 end;
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

-- ---------------------------------------------------------------------------
-- 4. Quote requests may ask for any of the lines (was at most 4)
-- ---------------------------------------------------------------------------
alter table public.intake_submissions drop constraint intake_submissions_lines_check;
alter table public.intake_submissions add constraint intake_submissions_lines_check check (cardinality(lines) between 1 and 13);

-- intake_clean from 20261025120000; only the two limits change (4 → 13).
create or replace function crm_engine.intake_clean(p_form jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_form, '{}'::jsonb);
  t text;
  k text;
  ln text;
  lines text[];
  cov jsonb := '[]'::jsonb;
  people jsonb := '[]'::jsonb;
  cars jsonb := '[]'::jsonb;
  item jsonb;
  m integer;
  mn numeric;
  out jsonb := '{}'::jsonb;
  max_year integer := extract(year from now())::integer + 2;
begin
  if jsonb_typeof(f) <> 'object' or pg_column_size(f) > 9000 then
    raise exception 'form' using errcode = '22023';
  end if;
  -- Plain text fields: trimmed, empty → null, length-limited.
  foreach k in array array['first_name', 'last_name', 'email', 'phone', 'postal_code', 'best_time', 'heard_about',
                           'referred_by_name', 'address_line1', 'city', 'state'] loop
    if f ? k and jsonb_typeof(f -> k) not in ('string', 'null') then
      raise exception '%', k using errcode = '22023';
    end if;
    t := nullif(btrim(f ->> k), '');
    if t is not null and char_length(t) > (case k when 'email' then 254 when 'phone' then 32 when 'address_line1' then 200 else 100 end) then
      raise exception '%', k using errcode = '22023';
    end if;
    out := out || jsonb_build_object(k, t);
  end loop;
  if out ->> 'first_name' is null then raise exception 'first_name' using errcode = '22023'; end if;
  if out ->> 'last_name' is null then raise exception 'last_name' using errcode = '22023'; end if;
  if out ->> 'email' is not null then
    if (out ->> 'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email' using errcode = '22023'; end if;
    out := out || jsonb_build_object('email', lower(out ->> 'email'));
  end if;
  if out ->> 'phone' is not null and char_length(regexp_replace(out ->> 'phone', '\D', '', 'g')) not between 10 and 11 then
    raise exception 'phone' using errcode = '22023';
  end if;
  if out ->> 'email' is null and out ->> 'phone' is null then raise exception 'reach' using errcode = '22023'; end if;
  if out ->> 'postal_code' is not null and (out ->> 'postal_code') !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'postal_code' using errcode = '22023';
  end if;
  if out ->> 'state' is not null then
    if upper(out ->> 'state') !~ '^[A-Z]{2}$' then raise exception 'state' using errcode = '22023'; end if;
    out := out || jsonb_build_object('state', upper(out ->> 'state'));
  end if;

  t := nullif(btrim(f ->> 'preferred_contact_method'), '');
  if t is not null and t not in ('phone', 'text', 'email') then
    raise exception 'preferred_contact_method' using errcode = '22023';
  end if;
  out := out || jsonb_build_object('preferred_contact_method', t);

  -- Lines: 1–13 distinct product lines (Phase 30; was 1–4).
  if jsonb_typeof(f -> 'lines') is distinct from 'array' then raise exception 'lines' using errcode = '22023'; end if;
  select array_agg(distinct v order by v) into lines from jsonb_array_elements_text(f -> 'lines') v;
  if lines is null or cardinality(lines) > 13
     or exists (select 1 from unnest(lines) l where not exists (select 1 from public.product_lines p where p.code = l)) then
    raise exception 'lines' using errcode = '22023';
  end if;
  out := out || jsonb_build_object('lines', to_jsonb(lines));

  -- Current coverage: optional, one entry per chosen line at most.
  if f ? 'current_coverage' and jsonb_typeof(f -> 'current_coverage') <> 'null' then
    if jsonb_typeof(f -> 'current_coverage') <> 'array' or jsonb_array_length(f -> 'current_coverage') > 13 then
      raise exception 'current_coverage' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(f -> 'current_coverage') loop
      ln := item ->> 'line';
      if jsonb_typeof(item) <> 'object' or ln is null or not (ln = any (lines))
         or exists (select 1 from jsonb_array_elements(cov) c where c ->> 'line' = ln) then
        raise exception 'current_coverage' using errcode = '22023';
      end if;
      t := nullif(btrim(item ->> 'carrier'), '');
      if t is not null and char_length(t) > 100 then raise exception 'current_coverage' using errcode = '22023'; end if;
      m := null;
      if item ? 'renews_month' and jsonb_typeof(item -> 'renews_month') <> 'null' then
        if jsonb_typeof(item -> 'renews_month') <> 'number' then raise exception 'current_coverage' using errcode = '22023'; end if;
        mn := (item ->> 'renews_month')::numeric;
        if mn not between 1 and 12 or mn <> trunc(mn) then
          raise exception 'current_coverage' using errcode = '22023';
        end if;
        m := mn::integer;
      end if;
      if t is not null or m is not null then
        cov := cov || jsonb_build_array(jsonb_build_object('line', ln, 'carrier', t, 'renews_month', m));
      end if;
    end loop;
  end if;
  out := out || jsonb_build_object('current_coverage', cov);

  -- Household: up to 6 people, first name required, relationship from a fixed list.
  if f ? 'household' and jsonb_typeof(f -> 'household') <> 'null' then
    if jsonb_typeof(f -> 'household') <> 'array' or jsonb_array_length(f -> 'household') > 6 then
      raise exception 'household' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(f -> 'household') loop
      if jsonb_typeof(item) <> 'object'
         or jsonb_typeof(coalesce(item -> 'first_name', 'null')) not in ('string', 'null')
         or jsonb_typeof(coalesce(item -> 'last_name', 'null')) not in ('string', 'null') then
        raise exception 'household' using errcode = '22023';
      end if;
      t := nullif(btrim(item ->> 'first_name'), '');
      k := nullif(btrim(item ->> 'last_name'), '');
      ln := coalesce(nullif(btrim(item ->> 'relationship'), ''), 'other');
      if t is null or char_length(t) > 100 or char_length(k) > 100 or ln not in ('spouse', 'child', 'parent', 'other') then
        raise exception 'household' using errcode = '22023';
      end if;
      people := people || jsonb_build_array(jsonb_build_object('first_name', t, 'last_name', k, 'relationship', ln));
    end loop;
  end if;
  out := out || jsonb_build_object('household', people);

  -- Vehicles: up to 4, only with an auto quote; year and make required.
  if f ? 'vehicles' and jsonb_typeof(f -> 'vehicles') <> 'null' then
    if jsonb_typeof(f -> 'vehicles') <> 'array' or jsonb_array_length(f -> 'vehicles') > 4
       or (jsonb_array_length(f -> 'vehicles') > 0 and not ('auto' = any (lines))) then
      raise exception 'vehicles' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(f -> 'vehicles') loop
      if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'year') is distinct from 'number'
         or jsonb_typeof(coalesce(item -> 'make', 'null')) not in ('string', 'null')
         or jsonb_typeof(coalesce(item -> 'model', 'null')) not in ('string', 'null') then
        raise exception 'vehicles' using errcode = '22023';
      end if;
      mn := (item ->> 'year')::numeric;
      t := nullif(btrim(item ->> 'make'), '');
      k := nullif(btrim(item ->> 'model'), '');
      if mn not between 1900 and max_year or mn <> trunc(mn) or t is null or char_length(t) > 50 or char_length(k) > 50 then
        raise exception 'vehicles' using errcode = '22023';
      end if;
      cars := cars || jsonb_build_array(jsonb_build_object('year', mn::integer, 'make', t, 'model', k));
    end loop;
  end if;
  return out || jsonb_build_object('vehicles', cars);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cross-sell rules may name any of the lines a client already holds
-- ---------------------------------------------------------------------------
alter table public.cross_sell_rules drop constraint cross_sell_rules_has_any_lines_check;
alter table public.cross_sell_rules add constraint cross_sell_rules_has_any_lines_check check (
  cardinality(has_any_lines) between 1 and 13
  and has_any_lines <@ array['auto', 'motorcycle', 'boat', 'rv', 'home', 'renters', 'condo', 'mobile_home', 'umbrella', 'commercial', 'commercial_auto', 'farm', 'life']
);
