-- Phase 13: intake form (ADR-028).
--
-- Owner decisions (2026-10-16):
--   * Both a public link for prospects and a quick in-app intake for the agent.
--   * Public submissions land in a review inbox; the agent accepts (creating or updating the
--     contact, a New lead opportunity per line and a quote task before the current policy
--     renews) or discards. Either way the submission's personal details are then erased.
--   * Fields: contact details, lines wanted, current carrier + renewal month per line, how they
--     heard about the agency / who referred them, and consent to be contacted.
--
-- Security model. This is the first thing an anonymous caller may do: exactly ONE function,
-- public.submit_intake, is executable by `anon`. It is SECURITY DEFINER (anon has no table
-- privileges at all), validates every field, accepts only an enabled link token, and limits
-- each link to 10 submissions per hour and 50 per day. It can only add a row to the inbox; it
-- returns nothing and cannot read anything. Everything else runs as the signed-in user
-- (SECURITY INVOKER), so row level security (owner + two-step) applies.

-- ---------------------------------------------------------------------------
-- Opportunities: what the prospect has today
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column current_carrier text check (char_length(current_carrier) <= 100),
  add column current_policy_renews_on date;

comment on column public.opportunities.current_carrier is
  'Prospect''s current insurer for this line (from intake), if known.';
comment on column public.opportunities.current_policy_renews_on is
  'When the prospect''s current policy renews (first of the month given on intake): the quote deadline.';

-- ---------------------------------------------------------------------------
-- Intake links (one active per agent; replaced links stay, disabled)
-- ---------------------------------------------------------------------------
create table public.intake_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  -- 32 hex characters from a random UUID (122 random bits): the link cannot be guessed.
  token text not null default replace(gen_random_uuid()::text, '-', '')
    check (token ~ '^[0-9a-f]{32}$'),
  enabled boolean not null default true,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_links_token_key unique (token),
  constraint intake_links_id_owner_key unique (id, owner_id),
  constraint intake_links_disabled_check check (enabled = (disabled_at is null))
);
comment on table public.intake_links is
  'Public intake form links (/quote/<token>). One enabled link per agent; replaced links are kept, disabled.';

create unique index intake_links_one_enabled_idx on public.intake_links (owner_id) where enabled;

create trigger intake_links_touch before update on public.intake_links
  for each row execute function crm_private.touch_row();
create trigger intake_links_keep_owner before update on public.intake_links
  for each row execute function crm_private.keep_owner();
create trigger intake_links_audit after insert or update or delete on public.intake_links
  for each row execute function crm_private.write_audit_log();

-- ---------------------------------------------------------------------------
-- Intake submissions (the review inbox)
-- ---------------------------------------------------------------------------
create table public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  link_id uuid not null,
  status text not null default 'new' check (status in ('new', 'accepted', 'discarded')),
  -- Personal details: present while the submission is new, erased once reviewed.
  first_name text check (char_length(first_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  email text check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 32),
  postal_code text check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  preferred_contact_method public.contact_method,
  best_time text check (char_length(best_time) <= 100),
  lines text[] check (cardinality(lines) between 1 and 4),
  -- [{"line": "auto", "carrier": "…", "renews_month": 3}, …]
  current_coverage jsonb check (jsonb_typeof(current_coverage) = 'array' and pg_column_size(current_coverage) <= 2000),
  heard_about text check (char_length(heard_about) <= 100),
  referred_by_name text check (char_length(referred_by_name) <= 100),
  -- Consent to be contacted (kept after review: when and which wording, no personal data).
  consent_at timestamptz not null,
  consent_version text not null check (char_length(consent_version) <= 20),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_submissions_link_fk foreign key (link_id, owner_id)
    references public.intake_links (id, owner_id) on delete restrict,
  constraint intake_submissions_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  constraint intake_submissions_state_check check (
    case status
      when 'new' then reviewed_at is null and contact_id is null
        and first_name is not null and last_name is not null
        and (email is not null or phone is not null) and lines is not null
      when 'accepted' then reviewed_at is not null and contact_id is not null
      else reviewed_at is not null and contact_id is null
    end
  ),
  constraint intake_submissions_erased_check check (
    status = 'new' or num_nonnulls(first_name, last_name, email, phone, postal_code,
      preferred_contact_method, best_time, lines, current_coverage, heard_about, referred_by_name) = 0
  )
);
comment on table public.intake_submissions is
  'Intake form submissions awaiting review. Personal details are erased when accepted or discarded. Not audited (the audit log would keep the erased details).';

create index intake_submissions_owner_status_idx on public.intake_submissions (owner_id, status, submitted_at);
create index intake_submissions_link_time_idx on public.intake_submissions (link_id, submitted_at);

create trigger intake_submissions_touch before update on public.intake_submissions
  for each row execute function crm_private.touch_row();
create trigger intake_submissions_keep_owner before update on public.intake_submissions
  for each row execute function crm_private.keep_owner();

-- ---------------------------------------------------------------------------
-- Row level security, two-step requirement and privileges
-- ---------------------------------------------------------------------------
alter table public.intake_links enable row level security;
alter table public.intake_submissions enable row level security;

revoke all on public.intake_links, public.intake_submissions from anon, authenticated;
grant select, insert on public.intake_links to authenticated;
grant update (enabled, disabled_at) on public.intake_links to authenticated;
-- No INSERT: submissions arrive only through public.submit_intake.
grant select, update on public.intake_submissions to authenticated;

create policy intake_links_select_own on public.intake_links
  for select to authenticated using (owner_id = (select auth.uid()));
create policy intake_links_insert_own on public.intake_links
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy intake_links_update_own on public.intake_links
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy intake_submissions_select_own on public.intake_submissions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy intake_submissions_update_own on public.intake_submissions
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy intake_links_require_mfa on public.intake_links
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy intake_submissions_require_mfa on public.intake_submissions
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Shared intake logic (invoker; crm_engine is closed to anon)
-- ---------------------------------------------------------------------------

-- Checks an intake form (JSON) and returns it normalised. Raises 22023 with a short reason.
-- Keys: first_name, last_name, email, phone, postal_code, preferred_contact_method, best_time,
-- lines[], current_coverage[{line, carrier, renews_month}], heard_about, referred_by_name.
create function crm_engine.intake_clean(p_form jsonb)
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
  item jsonb;
  m integer;
  mn numeric;
  out jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(f) <> 'object' or pg_column_size(f) > 6000 then
    raise exception 'form' using errcode = '22023';
  end if;
  -- Plain text fields: trimmed, empty → null, length-limited.
  foreach k in array array['first_name', 'last_name', 'email', 'phone', 'postal_code', 'best_time', 'heard_about', 'referred_by_name'] loop
    if f ? k and jsonb_typeof(f -> k) not in ('string', 'null') then
      raise exception '%', k using errcode = '22023';
    end if;
    t := nullif(btrim(f ->> k), '');
    if t is not null and char_length(t) > (case k when 'email' then 254 when 'phone' then 32 else 100 end) then
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

  t := nullif(btrim(f ->> 'preferred_contact_method'), '');
  if t is not null and t not in ('phone', 'text', 'email') then
    raise exception 'preferred_contact_method' using errcode = '22023';
  end if;
  out := out || jsonb_build_object('preferred_contact_method', t);

  -- Lines: 1–4 distinct product lines.
  if jsonb_typeof(f -> 'lines') <> 'array' then raise exception 'lines' using errcode = '22023'; end if;
  select array_agg(distinct v order by v) into lines from jsonb_array_elements_text(f -> 'lines') v;
  if lines is null or cardinality(lines) > 4
     or exists (select 1 from unnest(lines) l where not exists (select 1 from public.product_lines p where p.code = l)) then
    raise exception 'lines' using errcode = '22023';
  end if;
  out := out || jsonb_build_object('lines', to_jsonb(lines));

  -- Current coverage: optional, one entry per chosen line at most.
  if f ? 'current_coverage' and jsonb_typeof(f -> 'current_coverage') <> 'null' then
    if jsonb_typeof(f -> 'current_coverage') <> 'array' or jsonb_array_length(f -> 'current_coverage') > 4 then
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
  return out || jsonb_build_object('current_coverage', cov);
end;
$$;

-- The first day of the given month on or after today's month (a renewal "in March").
create function crm_engine.next_month_start(p_month integer, p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_month is null then null
    when p_month >= extract(month from p_today)::integer
      then make_date(extract(year from p_today)::integer, p_month, 1)
    else make_date(extract(year from p_today)::integer + 1, p_month, 1)
  end;
$$;

-- Creates (or adds to) the contact, a New lead opportunity per line, and a quote task before
-- each known renewal. Returns the contact id. Runs as the signed-in user.
create function crm_engine.intake_apply(
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
    insert into public.contacts (contact_type, first_name, last_name, email, phone, postal_code,
      preferred_contact_method, lead_source, referred_by_contact_id, notes)
    values ('individual', f ->> 'first_name', f ->> 'last_name', f ->> 'email', f ->> 'phone',
      f ->> 'postal_code', (f ->> 'preferred_contact_method')::public.contact_method,
      coalesce(f ->> 'heard_about', 'Intake form'), p_referred_by, p_note)
    returning id into cid;
  else
    update public.contacts c set
      email = coalesce(c.email, f ->> 'email'),
      phone = coalesce(c.phone, f ->> 'phone'),
      postal_code = coalesce(c.postal_code, f ->> 'postal_code'),
      preferred_contact_method = coalesce(c.preferred_contact_method, (f ->> 'preferred_contact_method')::public.contact_method),
      lead_source = coalesce(c.lead_source, f ->> 'heard_about'),
      referred_by_contact_id = coalesce(c.referred_by_contact_id, nullif(p_referred_by, c.id)),
      notes = left(concat_ws(e'\n\n', c.notes, p_note), 5000)
    where c.id = cid and c.archived_at is null;
    if not found then
      raise exception 'That contact could not be found (or is archived).' using errcode = 'P0002';
    end if;
  end if;

  for ln in select jsonb_array_elements_text(f -> 'lines') loop
    select c into cov from jsonb_array_elements(f -> 'current_coverage') c where c ->> 'line' = ln;
    renews := crm_engine.next_month_start((cov ->> 'renews_month')::integer, today);
    insert into public.opportunities (contact_id, product_line, stage_id, current_carrier, current_policy_renews_on)
    select cid, ln, s.id, cov ->> 'carrier', renews
    from public.pipeline_stages s where s.product_line = ln and s.position = 1
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

revoke all on function crm_engine.intake_clean(jsonb), crm_engine.next_month_start(integer, date),
  crm_engine.intake_apply(jsonb, uuid, uuid, text) from public, anon;
grant execute on function crm_engine.intake_clean(jsonb), crm_engine.next_month_start(integer, date),
  crm_engine.intake_apply(jsonb, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The one public entry point
-- ---------------------------------------------------------------------------
create function public.submit_intake(p_token text, p_form jsonb, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
  f jsonb;
  last_hour integer;
  last_day integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  select * into link from public.intake_links l where l.token = p_token and l.enabled for update;
  if not found then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  if p_consent is not true then
    raise exception 'consent' using errcode = '22023';
  end if;
  select count(*) filter (where s.submitted_at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
  from public.intake_submissions s
  where s.link_id = link.id and s.submitted_at > now() - interval '1 day';
  if last_hour >= 10 or last_day >= 50 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  f := crm_engine.intake_clean(p_form);
  insert into public.intake_submissions (owner_id, link_id, first_name, last_name, email, phone,
    postal_code, preferred_contact_method, best_time, lines, current_coverage, heard_about,
    referred_by_name, consent_at, consent_version)
  values (link.owner_id, link.id, f ->> 'first_name', f ->> 'last_name', f ->> 'email', f ->> 'phone',
    f ->> 'postal_code', (f ->> 'preferred_contact_method')::public.contact_method, f ->> 'best_time',
    array(select jsonb_array_elements_text(f -> 'lines')), f -> 'current_coverage',
    f ->> 'heard_about', f ->> 'referred_by_name', now(), 'v1');
end;
$$;
comment on function public.submit_intake(text, jsonb, boolean) is
  'Public intake form (ADR-028): the ONLY function anon may call. Adds one submission to the link owner''s inbox; returns nothing.';

revoke all on function public.submit_intake(text, jsonb, boolean) from public, authenticated;
grant execute on function public.submit_intake(text, jsonb, boolean) to anon;

-- ---------------------------------------------------------------------------
-- Agent functions (invoker)
-- ---------------------------------------------------------------------------

-- Accept a new submission: into a new contact, or into p_contact_id (an existing contact).
create function public.accept_intake(p_id uuid, p_contact_id uuid default null, p_referred_by uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  s public.intake_submissions;
  cid uuid;
begin
  select * into s from public.intake_submissions x where x.id = p_id and x.status = 'new' for update;
  if not found then
    raise exception 'This submission was already handled or could not be found.' using errcode = 'P0002';
  end if;
  cid := crm_engine.intake_apply(
    jsonb_build_object('first_name', s.first_name, 'last_name', s.last_name, 'email', s.email,
      'phone', s.phone, 'postal_code', s.postal_code, 'preferred_contact_method', s.preferred_contact_method,
      'best_time', s.best_time, 'lines', to_jsonb(s.lines), 'current_coverage', s.current_coverage,
      'heard_about', s.heard_about, 'referred_by_name', s.referred_by_name),
    p_contact_id, p_referred_by,
    'Intake form ' || to_char(s.submitted_at at time zone 'America/New_York', 'YYYY-MM-DD')
      || ': agreed to be contacted by phone, text or email.'
      || coalesce(' Best time to reach: ' || s.best_time || '.', '')
      || coalesce(' Referred by (as written): ' || s.referred_by_name || '.', ''));
  update public.intake_submissions x set
    status = 'accepted', reviewed_at = now(), contact_id = cid,
    first_name = null, last_name = null, email = null, phone = null, postal_code = null,
    preferred_contact_method = null, best_time = null, lines = null, current_coverage = null,
    heard_about = null, referred_by_name = null
  where x.id = p_id;
  return cid;
end;
$$;

create function public.discard_intake(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.intake_submissions x set
    status = 'discarded', reviewed_at = now(),
    first_name = null, last_name = null, email = null, phone = null, postal_code = null,
    preferred_contact_method = null, best_time = null, lines = null, current_coverage = null,
    heard_about = null, referred_by_name = null
  where x.id = p_id and x.status = 'new';
  if not found then
    raise exception 'This submission was already handled or could not be found.' using errcode = 'P0002';
  end if;
end;
$$;

-- The agent's own intake (on a call): straight into the CRM, same rules as accepting.
create function public.quick_intake(p_form jsonb, p_contact_id uuid default null, p_referred_by uuid default null)
returns uuid
language sql
set search_path = ''
as $$
  select crm_engine.intake_apply(p_form, p_contact_id, p_referred_by,
    'Quick intake ' || crm_engine.user_today()::text
      || coalesce(': best time to reach: ' || nullif(btrim(p_form ->> 'best_time'), '') || '.', '.')
      || coalesce(' Referred by (as written): ' || nullif(btrim(p_form ->> 'referred_by_name'), '') || '.', ''));
$$;

-- Replace the agent's link: the old one stops working at once. Returns the new token.
create function public.rotate_intake_link()
returns text
language plpgsql
set search_path = ''
as $$
declare
  t text;
begin
  update public.intake_links l set enabled = false, disabled_at = now()
  where l.owner_id = (select auth.uid()) and l.enabled;
  insert into public.intake_links default values returning token into t;
  return t;
end;
$$;

revoke all on function public.accept_intake(uuid, uuid, uuid), public.discard_intake(uuid),
  public.quick_intake(jsonb, uuid, uuid), public.rotate_intake_link() from public, anon;
grant execute on function public.accept_intake(uuid, uuid, uuid), public.discard_intake(uuid),
  public.quick_intake(jsonb, uuid, uuid), public.rotate_intake_link() to authenticated;
