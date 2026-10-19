-- Existing policies entered by hand (owner report 2026-10-19, ADR-042).
--
-- Adding an existing client by hand meant creating an opportunity and moving it to Bound, which
-- the automation treats as a sale closed today: onboarding checklist, review and referral
-- requests, and a "won" in this period's reports. The app now saves such a policy directly as
-- won, like the import does: on INSERT the automation only creates the renewal review (the
-- won-sale rules fire on the change to won, never on insert), and the contact becomes a client.
--
-- 1. opportunities.existing_policy marks these rows. It can only be set when the row is
--    created as won, and never changes afterwards (a reopened and re-won policy keeps it).
-- 2. Reports treat them like imported history: not counted as sales (conversion), and a
--    contact added with an existing policy is not a new lead or a new referral.
-- No existing rows change.

alter table public.opportunities
  add column existing_policy boolean not null default false;
comment on column public.opportunities.existing_policy is
  'True when entered as a policy the client already had (not a sale made in the CRM).';

create function crm_private.existing_policy_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.existing_policy and new.outcome <> 'won' then
      raise exception 'An existing policy is saved as won.' using errcode = 'check_violation';
    end if;
  else
    new.existing_policy := old.existing_policy;
  end if;
  return new;
end;
$$;
revoke all on function crm_private.existing_policy_guard() from public, anon, authenticated;

create trigger opportunities_existing_policy before insert or update on public.opportunities
  for each row execute function crm_private.existing_policy_guard();

-- ---------------------------------------------------------------------------
-- Reports (as in 20261026120000_import_export.sql, plus the existing_policy exclusions)
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

