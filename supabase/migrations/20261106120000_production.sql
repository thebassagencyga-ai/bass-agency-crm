-- Phase 28 (ADR-046): production and commission tracking. Owner decisions 2026-10-20: production
-- + commission first; all lines; estimates only (no statement actuals yet); mockup approved,
-- design approved ("Approved, build it").
--
-- 1. commission_rates: the agent's own rates per line (auto, home, commercial: new business and
--    renewal) and per life policy type (first year and renewal years). Empty until entered.
-- 2. production_goals: premium per month, policies per month, premium per year.
-- 3. Opportunities (life only): policy type, premium mode, first payout date, rate override.
-- 4. production_report(month): written premium and policies, expected commission for the month,
--    by line, year to date, and the next 12 months from policies already on the books.
--    SECURITY INVOKER, read-only.
--
-- Estimates only: the page says carrier statements are the final word. No AI.

-- ---------------------------------------------------------------------------
-- 1. Commission rates
-- ---------------------------------------------------------------------------
create table public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  product_line text not null references public.product_lines (code) on delete restrict,
  -- Life only: the policy type the rate is for.
  life_policy_type text check (life_policy_type in ('term', 'whole', 'universal', 'indexed_universal', 'final_expense')),
  -- Percent of premium. New business (life: first year) and renewal (life: renewal years).
  new_rate numeric(5, 2) check (new_rate between 0 and 100),
  renewal_rate numeric(5, 2) check (renewal_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rates_life_type_check check ((product_line = 'life') = (life_policy_type is not null))
);
comment on table public.commission_rates is
  'Phase 28: the agent''s own commission rates (percent) per line, and per policy type for life. Estimates, not contract terms.';
create unique index commission_rates_owner_line_idx
  on public.commission_rates (owner_id, product_line, coalesce(life_policy_type, ''));

create trigger commission_rates_touch before update on public.commission_rates
  for each row execute function crm_private.touch_row();
create trigger commission_rates_keep_owner before update on public.commission_rates
  for each row execute function crm_private.keep_owner();
create trigger commission_rates_audit after insert or update or delete on public.commission_rates
  for each row execute function crm_private.write_audit_log();

alter table public.commission_rates enable row level security;
revoke all on public.commission_rates from anon, authenticated;
grant select on public.commission_rates to authenticated;
grant insert (product_line, life_policy_type, new_rate, renewal_rate) on public.commission_rates to authenticated;
grant update (new_rate, renewal_rate) on public.commission_rates to authenticated;

create policy commission_rates_select_own on public.commission_rates
  for select to authenticated using (owner_id = (select auth.uid()));
create policy commission_rates_insert_own on public.commission_rates
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy commission_rates_update_own on public.commission_rates
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy commission_rates_require_mfa on public.commission_rates
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- 2. Production goals (one row per agent)
-- ---------------------------------------------------------------------------
create table public.production_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  premium_per_month numeric(12, 2) check (premium_per_month >= 0),
  policies_per_month integer check (policies_per_month between 0 and 10000),
  premium_per_year numeric(12, 2) check (premium_per_year >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_goals_owner_key unique (owner_id)
);
comment on table public.production_goals is 'Phase 28: the agent''s production goals (all optional).';

create trigger production_goals_touch before update on public.production_goals
  for each row execute function crm_private.touch_row();
create trigger production_goals_keep_owner before update on public.production_goals
  for each row execute function crm_private.keep_owner();
create trigger production_goals_audit after insert or update or delete on public.production_goals
  for each row execute function crm_private.write_audit_log();

alter table public.production_goals enable row level security;
revoke all on public.production_goals from anon, authenticated;
grant select on public.production_goals to authenticated;
grant insert (premium_per_month, policies_per_month, premium_per_year) on public.production_goals to authenticated;
grant update (premium_per_month, policies_per_month, premium_per_year) on public.production_goals to authenticated;

create policy production_goals_select_own on public.production_goals
  for select to authenticated using (owner_id = (select auth.uid()));
create policy production_goals_insert_own on public.production_goals
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy production_goals_update_own on public.production_goals
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy production_goals_require_mfa on public.production_goals
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- 3. Life commission details on opportunities
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column life_policy_type text check (life_policy_type in ('term', 'whole', 'universal', 'indexed_universal', 'final_expense')),
  add column premium_mode text check (premium_mode in ('monthly', 'quarterly', 'semiannual', 'annual')),
  add column first_payout_on date,
  add column commission_rate_override numeric(5, 2) check (commission_rate_override between 0 and 100),
  add constraint opportunities_life_commission_check check (
    product_line = 'life'
    or num_nonnulls(life_policy_type, premium_mode, first_payout_on, commission_rate_override) = 0
  );
comment on column public.opportunities.life_policy_type is 'Phase 28, life only: Term, Whole, Universal, Indexed Universal or Final Expense.';
comment on column public.opportunities.premium_mode is 'Phase 28, life only: how often premium (and commission) is paid; monthly when not set.';
comment on column public.opportunities.first_payout_on is 'Phase 28, life only: first commission payout; the effective date when not set.';
comment on column public.opportunities.commission_rate_override is 'Phase 28, life only: first-year rate for this policy, overriding Settings.';

-- ---------------------------------------------------------------------------
-- 4. production_report(month)
-- ---------------------------------------------------------------------------
-- Rules (ADR-046):
-- * Written in a month: won that month (closed_at, the agent's time zone), not an existing
--   policy, not imported; premium = estimated annual premium.
-- * Auto/home/commercial: new business = premium × new-business rate in the month bound;
--   renewal = premium × renewal rate in the month of the renewal date: the recorded premium of
--   a renewed or re-marketed renewal, or (not recorded yet) the premium on file of an active
--   policy whose renewal falls that month (6-month terms repeat). Lost renewals earn nothing.
--   The whole book counts for renewals, existing and imported policies included.
-- * Life: premium ÷ payments per year × rate, in the months the premium mode pays from the
--   first payout date (else the effective date, else the bound date); the first-year rate
--   (the policy's override, else Settings) for 12 months, then the renewal rate; none after
--   the policy ends. Premium mode not set = monthly.
-- * The next 12 months add no new sales (only the selected month's actual new business).
create function public.production_report(p_month date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := coalesce((select p.time_zone from public.profiles p where p.id = auth.uid()), 'America/New_York');
  m0 date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  y0 date := date_trunc('year', p_month)::date;
  w_end date := (date_trunc('month', p_month) + interval '12 months - 1 day')::date;
begin
  if p_month is null or p_month < date '2000-01-01' or p_month > date '2100-01-01' then
    raise exception 'Choose a month.' using errcode = 'invalid_parameter_value';
  end if;

  return (
    with months as (
      select g::date as m from generate_series(m0, (m0 + interval '11 months')::date, interval '1 month') g
    ),
    rates as (
      select r.product_line, r.life_policy_type, r.new_rate, r.renewal_rate from public.commission_rates r
    ),
    pc_rate as (
      select product_line, new_rate, renewal_rate from rates where life_policy_type is null
    ),
    won as (
      select o.*, (o.closed_at at time zone tz)::date as bound_on
      from public.opportunities o
      where o.outcome = 'won'
    ),
    -- Policies written (sales) in the window, by bound month.
    written as (
      select w.*, date_trunc('month', w.bound_on)::date as m
      from won w
      where not w.existing_policy and w.import_batch_id is null and w.bound_on between y0 and w_end
    ),
    -- Auto/home/commercial new business commission by month.
    pc_new as (
      select w.m, w.product_line, count(*) as policies, coalesce(sum(w.estimated_annual_premium), 0) as premium,
        coalesce(sum(w.estimated_annual_premium * pr.new_rate / 100), 0) as commission
      from written w left join pc_rate pr on pr.product_line = w.product_line
      where w.product_line <> 'life'
      group by w.m, w.product_line
    ),
    -- Renewals: recorded (renewed / re-marketed) plus projected dates not yet recorded.
    pc_renewals as (
      select date_trunc('month', r.renewal_date)::date as m, o.product_line,
        coalesce(r.premium, o.estimated_annual_premium) as premium
      from public.renewal_outcomes r join public.opportunities o on o.id = r.opportunity_id
      where o.product_line <> 'life' and r.outcome in ('renewed', 'remarketed')
        and r.renewal_date between m0 and w_end
      union all
      select date_trunc('month', d.d)::date, o.product_line, o.estimated_annual_premium
      from won o
      cross join lateral (
        select (o.renewal_date + make_interval(months => k * o.policy_term_months))::date as d
        from generate_series(0, 24) k
      ) d
      where o.product_line <> 'life' and o.policy_ended_on is null and o.renewal_date is not null
        and d.d between m0 and w_end
        and not exists (select 1 from public.renewal_outcomes x where x.opportunity_id = o.id and x.renewal_date = d.d)
    ),
    pc_ren as (
      select r.m, r.product_line, count(*) as renewals, coalesce(sum(r.premium), 0) as premium,
        coalesce(sum(r.premium * pr.renewal_rate / 100), 0) as commission
      from pc_renewals r left join pc_rate pr on pr.product_line = r.product_line
      group by r.m, r.product_line
    ),
    -- Life instalments in the 12 months.
    life as (
      select o.id, o.estimated_annual_premium as premium, o.policy_ended_on,
        date_trunc('month', coalesce(o.first_payout_on, o.effective_date, o.bound_on))::date as start_m,
        case coalesce(o.premium_mode, 'monthly') when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 else 1 end as per_year,
        coalesce(o.commission_rate_override, lr.new_rate) as first_rate, lr.renewal_rate
      from won o left join rates lr on lr.product_line = 'life' and lr.life_policy_type = o.life_policy_type
      where o.product_line = 'life'
    ),
    life_pay as (
      select mo.m,
        case when (extract(year from age(mo.m, l.start_m)) * 12 + extract(month from age(mo.m, l.start_m))) < 12
             then 'first' else 'renewal' end as year_kind,
        coalesce(l.premium / l.per_year * (case when (extract(year from age(mo.m, l.start_m)) * 12 + extract(month from age(mo.m, l.start_m))) < 12
             then l.first_rate else l.renewal_rate end) / 100, 0) as amount
      from life l cross join months mo
      where mo.m >= l.start_m
        and (l.policy_ended_on is null or mo.m <= date_trunc('month', l.policy_ended_on)::date)
        and mod((extract(year from age(mo.m, l.start_m)) * 12 + extract(month from age(mo.m, l.start_m)))::integer, 12 / l.per_year) = 0
    ),
    life_written as (
      select count(*) as policies, coalesce(sum(estimated_annual_premium), 0) as premium
      from written where product_line = 'life' and m = m0
    ),
    lines as (
      select l.code as product_line, l.sort_order from public.product_lines l
    )
    select jsonb_build_object(
      'month', m0,
      'rates_set', exists (select 1 from rates where new_rate is not null or renewal_rate is not null),
      'goals', (select jsonb_build_object('premium_per_month', g.premium_per_month, 'policies_per_month', g.policies_per_month, 'premium_per_year', g.premium_per_year)
                from public.production_goals g limit 1),
      'written', jsonb_build_object(
        'policies', (select count(*) from written where m = m0),
        'premium', (select coalesce(sum(estimated_annual_premium), 0) from written where m = m0),
        'without_premium', (select count(*) from written where m = m0 and estimated_annual_premium is null)
      ),
      'ytd', jsonb_build_object(
        'policies', (select count(*) from written where bound_on between y0 and m_end),
        'premium', (select coalesce(sum(estimated_annual_premium), 0) from written where bound_on between y0 and m_end)
      ),
      'by_line', (
        select jsonb_agg(jsonb_build_object(
          'product_line', ln.product_line,
          'policies', case when ln.product_line = 'life' then (select policies from life_written) else coalesce(n.policies, 0) end,
          'premium', case when ln.product_line = 'life' then (select premium from life_written) else coalesce(n.premium, 0) end,
          'new_rate', (select pr.new_rate from pc_rate pr where pr.product_line = ln.product_line),
          'commission_new', case when ln.product_line = 'life'
              then (select coalesce(sum(amount), 0) from life_pay where m = m0 and year_kind = 'first')
              else coalesce(n.commission, 0) end,
          'renewals', case when ln.product_line = 'life' then null else coalesce(r.renewals, 0) end,
          'renewal_premium', case when ln.product_line = 'life' then null else coalesce(r.premium, 0) end,
          'renewal_rate', (select pr.renewal_rate from pc_rate pr where pr.product_line = ln.product_line),
          'commission_renewal', case when ln.product_line = 'life'
              then (select coalesce(sum(amount), 0) from life_pay where m = m0 and year_kind = 'renewal')
              else coalesce(r.commission, 0) end
        ) order by ln.sort_order)
        from lines ln
        left join pc_new n on n.product_line = ln.product_line and n.m = m0
        left join pc_ren r on r.product_line = ln.product_line and r.m = m0
      ),
      'forecast', (
        select jsonb_agg(jsonb_build_object(
          'month', mo.m,
          'renewals', (select coalesce(sum(commission), 0) from pc_ren where m = mo.m),
          'life', (select coalesce(sum(amount), 0) from life_pay where m = mo.m),
          'new_business', case when mo.m = m0 then (select coalesce(sum(commission), 0) from pc_new where m = m0) else 0 end
        ) order by mo.m)
        from months mo
      ),
      'active_policies', (select count(*) from won where policy_ended_on is null),
      'ended_this_month', (select count(*) from won where policy_ended_on between m0 and m_end),
      'life_without_type', (select count(*) from won where product_line = 'life' and policy_ended_on is null and life_policy_type is null and commission_rate_override is null)
    )
  );
end;
$$;

comment on function public.production_report(date) is
  'Phase 28 (ADR-046): written premium and policies, expected commission (estimates) for a month, by line, year to date and the next 12 months. Read-only; SECURITY INVOKER.';
revoke all on function public.production_report(date) from public, anon;
grant execute on function public.production_report(date) to authenticated;
