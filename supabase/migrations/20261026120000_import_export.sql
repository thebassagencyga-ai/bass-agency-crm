-- Phase 15: import a book of business from a CSV report, undo an import, export (ADR-031).
--
-- An import is one transaction: contacts (or policies added to existing contacts the user
-- matched) and won opportunities ("policies") with carrier, premium, dates. Every created row
-- carries import_batch_id. Imported history is not new business, so the new-lead, conversion
-- and referral reports ignore imported records.
--
-- Undo: the user marks the batch "undone" (an ordinary UPDATE through RLS). A trigger then
-- deletes the batch's records, all or nothing, only within 7 days and only if none of them was
-- changed or used since (no edits, activities, completed tasks, referrals, …). The app itself
-- still has no DELETE privilege; the trigger function is private (crm_private), like the audit
-- trigger. Deletions are written to the audit log.

-- ---------------------------------------------------------------------------
-- Import batches and markers
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 200),
  contacts_created integer not null default 0 check (contacts_created >= 0),
  contacts_matched integer not null default 0 check (contacts_matched >= 0),
  policies_created integer not null default 0 check (policies_created >= 0),
  status text not null default 'done' check (status in ('done', 'undone')),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batches_id_owner_key unique (id, owner_id),
  constraint import_batches_undone_check check ((status = 'undone') = (undone_at is not null))
);
comment on table public.import_batches is 'CSV imports (Phase 15): what each created; status "undone" after an undo.';

alter table public.contacts add column import_batch_id uuid,
  add constraint contacts_import_batch_fk foreign key (import_batch_id, owner_id)
    references public.import_batches (id, owner_id) on delete restrict;
alter table public.opportunities add column import_batch_id uuid,
  add constraint opportunities_import_batch_fk foreign key (import_batch_id, owner_id)
    references public.import_batches (id, owner_id) on delete restrict;
create index contacts_import_batch_idx on public.contacts (import_batch_id) where import_batch_id is not null;
create index opportunities_import_batch_idx on public.opportunities (import_batch_id) where import_batch_id is not null;

create trigger import_batches_touch before update on public.import_batches
  for each row execute function crm_private.touch_row();
create trigger import_batches_keep_owner before update on public.import_batches
  for each row execute function crm_private.keep_owner();
create trigger import_batches_audit after insert or update or delete on public.import_batches
  for each row execute function crm_private.write_audit_log();

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
-- Users change only the status (to undo) and, through import_book, the counts.
grant update (status, undone_at, contacts_created, contacts_matched, policies_created) on public.import_batches to authenticated;
grant insert on public.import_batches to authenticated;

create policy import_batches_select_own on public.import_batches
  for select to authenticated using (owner_id = (select auth.uid()));
create policy import_batches_insert_own on public.import_batches
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy import_batches_update_own on public.import_batches
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy import_batches_require_mfa on public.import_batches
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- The import (invoker: RLS and every table constraint apply)
-- ---------------------------------------------------------------------------
-- p_contacts: [{ "existing_contact_id": uuid|null,
--                "contact": {contact_type, first_name, last_name, business_name, email, phone,
--                            alt_phone, address_line1, city, state, postal_code, lead_source},
--                "policies": [{line, carrier, premium, effective_date, renewal_date, term_months}] }]
create function public.import_book(p_file_name text, p_contacts jsonb)
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
      select s.id into won_stage from public.pipeline_stages s where s.product_line = p ->> 'line' and s.kind = 'won';
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
comment on function public.import_book(text, jsonb) is
  'CSV import (Phase 15): one transaction; runs as the signed-in user (RLS applies).';
revoke all on function public.import_book(text, jsonb) from public, anon;
grant execute on function public.import_book(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Undo (private trigger; all or nothing)
-- ---------------------------------------------------------------------------
create function crm_private.undo_import()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not (old.status = 'done' and new.status = 'undone') then
    if new.status is distinct from old.status then
      raise exception 'An undone import cannot be restored.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.created_at < now() - interval '7 days' then
    raise exception 'import_too_old' using errcode = 'P0001';
  end if;

  -- Anything changed or used since the import blocks the undo.
  select
    (select count(*) from public.contacts c where c.import_batch_id = old.id and c.updated_at <> c.created_at)
  + (select count(*) from public.opportunities o where o.import_batch_id = old.id and o.updated_at <> o.created_at)
  + (select count(*) from public.opportunities o join public.contacts c on c.id = o.contact_id
      where c.import_batch_id = old.id and o.import_batch_id is distinct from old.id)
  + (select count(*) from public.tasks t where (t.opportunity_id in (select id from public.opportunities where import_batch_id = old.id)
        or t.contact_id in (select id from public.contacts where import_batch_id = old.id))
      and (t.origin <> 'automation' or t.status <> 'open' or t.updated_at <> t.created_at))
  + (select count(*) from public.activities a where a.contact_id in (select id from public.contacts where import_batch_id = old.id)
        or a.opportunity_id in (select id from public.opportunities where import_batch_id = old.id))
  + (select count(*) from public.renewal_outcomes r where r.opportunity_id in (select id from public.opportunities where import_batch_id = old.id))
  + (select count(*) from public.contacts c where c.referred_by_contact_id in (select id from public.contacts where import_batch_id = old.id))
  + (select count(*) from public.cross_sell_dismissals d where d.contact_id in (select id from public.contacts where import_batch_id = old.id))
  + (select count(*) from public.household_members h where h.contact_id in (select id from public.contacts where import_batch_id = old.id))
  + (select count(*) from public.vehicles v where v.contact_id in (select id from public.contacts where import_batch_id = old.id))
  + (select count(*) from public.intake_submissions s where s.contact_id in (select id from public.contacts where import_batch_id = old.id))
  into changed;
  if changed > 0 then
    raise exception 'import_changed' using errcode = 'P0001';
  end if;

  delete from public.tasks t
  where t.opportunity_id in (select id from public.opportunities where import_batch_id = old.id)
     or t.contact_id in (select id from public.contacts where import_batch_id = old.id);
  delete from public.opportunities where import_batch_id = old.id;
  delete from public.contacts where import_batch_id = old.id;
  new.undone_at := now();
  return new;
end;
$$;
revoke all on function crm_private.undo_import() from public, anon, authenticated;

create trigger import_batches_undo before update on public.import_batches
  for each row execute function crm_private.undo_import();

-- ---------------------------------------------------------------------------
-- Reports: imported history is not new business
-- ---------------------------------------------------------------------------
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

    -- 1. Open pipeline now: open and nurture opportunities by line and stage.
    'open_pipeline', coalesce((
      select jsonb_agg(row_to_json(x) order by x.product_line, x.stage_position)
      from (
        select o.product_line, s.name as stage_name, s.position as stage_position,
          count(*) filter (where o.outcome = 'open') as open_count,
          count(*) filter (where o.outcome = 'nurture') as nurture_count,
          coalesce(sum(o.estimated_annual_premium), 0) as premium,
          count(o.estimated_annual_premium) as with_premium
        from public.opportunities o
        join public.pipeline_stages s on s.id = o.stage_id
        where o.outcome in ('open', 'nurture')
        group by o.product_line, s.name, s.position
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
          and o.import_batch_id is null
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
      )
    )
  );
end;
$$;
