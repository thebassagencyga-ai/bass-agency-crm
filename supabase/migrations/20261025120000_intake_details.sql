-- Phase 14: intake details (ADR-029).
--
-- Owner decisions (2026-10-16): the intake form also asks for the street address, vehicles
-- (year, make, model — no VIN) and other drivers / household members (names and relationship
-- only). Dates of birth, driver's license numbers and VINs are NOT collected (data
-- minimisation rules in CLAUDE.md; tests/db/rls.test.ts blocks such columns).
--
-- Household members and vehicles belong to the contact (they outlive any one quote). They are
-- owner-only with the two-step requirement, audited, and archived rather than deleted.

-- ---------------------------------------------------------------------------
-- Household members and vehicles
-- ---------------------------------------------------------------------------
create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text check (char_length(last_name) <= 100),
  relationship text not null default 'other' check (relationship in ('spouse', 'child', 'parent', 'other')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_members_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict
);
comment on table public.household_members is
  'Other drivers / people in the client''s household: names and relationship only (no birth dates or license numbers).';
create index household_members_contact_idx on public.household_members (contact_id) where archived_at is null;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  year smallint not null check (year between 1900 and 2100),
  make text not null check (char_length(btrim(make)) between 1 and 50),
  model text check (char_length(model) <= 50),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict
);
comment on table public.vehicles is 'The client''s vehicles: year, make, model (no VIN).';
create index vehicles_contact_idx on public.vehicles (contact_id) where archived_at is null;

create trigger household_members_touch before update on public.household_members
  for each row execute function crm_private.touch_row();
create trigger household_members_keep_owner before update on public.household_members
  for each row execute function crm_private.keep_owner();
create trigger household_members_audit after insert or update or delete on public.household_members
  for each row execute function crm_private.write_audit_log();
create trigger vehicles_touch before update on public.vehicles
  for each row execute function crm_private.touch_row();
create trigger vehicles_keep_owner before update on public.vehicles
  for each row execute function crm_private.keep_owner();
create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function crm_private.write_audit_log();

alter table public.household_members enable row level security;
alter table public.vehicles enable row level security;
revoke all on public.household_members, public.vehicles from anon, authenticated;
grant select, insert, update on public.household_members, public.vehicles to authenticated;

create policy household_members_select_own on public.household_members
  for select to authenticated using (owner_id = (select auth.uid()));
create policy household_members_insert_own on public.household_members
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy household_members_update_own on public.household_members
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy vehicles_select_own on public.vehicles
  for select to authenticated using (owner_id = (select auth.uid()));
create policy vehicles_insert_own on public.vehicles
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy vehicles_update_own on public.vehicles
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy household_members_require_mfa on public.household_members
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy vehicles_require_mfa on public.vehicles
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Intake submissions: the new details (erased on review, like the rest)
-- ---------------------------------------------------------------------------
alter table public.intake_submissions
  add column address_line1 text check (char_length(address_line1) <= 200),
  add column city text check (char_length(city) <= 100),
  add column state text check (state ~ '^[A-Z]{2}$'),
  -- [{"first_name": …, "last_name": …, "relationship": …}, …] (up to 6)
  add column household jsonb check (jsonb_typeof(household) = 'array' and pg_column_size(household) <= 2000),
  -- [{"year": 2019, "make": …, "model": …}, …] (up to 4)
  add column vehicles jsonb check (jsonb_typeof(vehicles) = 'array' and pg_column_size(vehicles) <= 1500),
  drop constraint intake_submissions_erased_check,
  add constraint intake_submissions_erased_check check (
    status = 'new' or num_nonnulls(first_name, last_name, email, phone, postal_code,
      preferred_contact_method, best_time, lines, current_coverage, heard_about, referred_by_name,
      address_line1, city, state, household, vehicles) = 0
  );

-- ---------------------------------------------------------------------------
-- Validation: the Phase 13 checks plus address, household and vehicles
-- ---------------------------------------------------------------------------
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

  -- Lines: 1–4 distinct product lines.
  if jsonb_typeof(f -> 'lines') is distinct from 'array' then raise exception 'lines' using errcode = '22023'; end if;
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
-- Applying an intake: address, household members and vehicles too
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Public submission, accept and discard: carry and erase the new details
-- ---------------------------------------------------------------------------
create or replace function public.submit_intake(p_token text, p_form jsonb, p_consent boolean)
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
    address_line1, city, state, postal_code, preferred_contact_method, best_time, lines, current_coverage,
    household, vehicles, heard_about, referred_by_name, consent_at, consent_version)
  values (link.owner_id, link.id, f ->> 'first_name', f ->> 'last_name', f ->> 'email', f ->> 'phone',
    f ->> 'address_line1', f ->> 'city', f ->> 'state',
    f ->> 'postal_code', (f ->> 'preferred_contact_method')::public.contact_method, f ->> 'best_time',
    array(select jsonb_array_elements_text(f -> 'lines')), f -> 'current_coverage',
    f -> 'household', f -> 'vehicles',
    f ->> 'heard_about', f ->> 'referred_by_name', now(), 'v1');
end;
$$;

create or replace function public.accept_intake(p_id uuid, p_contact_id uuid default null, p_referred_by uuid default null)
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
      'phone', s.phone, 'address_line1', s.address_line1, 'city', s.city, 'state', s.state,
      'postal_code', s.postal_code, 'preferred_contact_method', s.preferred_contact_method,
      'best_time', s.best_time, 'lines', to_jsonb(s.lines), 'current_coverage', s.current_coverage,
      'household', s.household, 'vehicles', s.vehicles,
      'heard_about', s.heard_about, 'referred_by_name', s.referred_by_name),
    p_contact_id, p_referred_by,
    'Intake form ' || to_char(s.submitted_at at time zone 'America/New_York', 'YYYY-MM-DD')
      || ': agreed to be contacted by phone, text or email.'
      || coalesce(' Best time to reach: ' || s.best_time || '.', '')
      || coalesce(' Referred by (as written): ' || s.referred_by_name || '.', ''));
  update public.intake_submissions x set
    status = 'accepted', reviewed_at = now(), contact_id = cid,
    first_name = null, last_name = null, email = null, phone = null, address_line1 = null, city = null,
    state = null, postal_code = null, preferred_contact_method = null, best_time = null, lines = null,
    current_coverage = null, household = null, vehicles = null, heard_about = null, referred_by_name = null
  where x.id = p_id;
  return cid;
end;
$$;

create or replace function public.discard_intake(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.intake_submissions x set
    status = 'discarded', reviewed_at = now(),
    first_name = null, last_name = null, email = null, phone = null, address_line1 = null, city = null,
    state = null, postal_code = null, preferred_contact_method = null, best_time = null, lines = null,
    current_coverage = null, household = null, vehicles = null, heard_about = null, referred_by_name = null
  where x.id = p_id and x.status = 'new';
  if not found then
    raise exception 'This submission was already handled or could not be found.' using errcode = 'P0002';
  end if;
end;
$$;
