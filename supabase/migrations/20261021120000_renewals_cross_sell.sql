-- Phase 8: renewals (retention workflow) and cross-selling (ADR-023).
--
-- Owner decisions (2026-10-15):
--   * Renewed / Re-marketed: the client stays; the renewal date rolls forward by the policy
--     term (auto 6 or 12 months, other lines 12), which creates the next renewal review.
--   * Lost: recorded with a reason; the policy ends (it stays "won" historically) and drops
--     out of renewals. A contact with no other active policy becomes a former client.
--   * A dismissed cross-sell prompt stays hidden for 12 months.
--
-- A "policy" is a won opportunity whose policy_ended_on is empty. Cross-sell rules look only
-- at recorded opportunities. Everything runs as the signed-in user (SECURITY INVOKER), so row
-- level security (owner + two-step) applies to every row read or written.

-- ---------------------------------------------------------------------------
-- Opportunities: policy term and end of policy
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column policy_term_months smallint not null default 12,
  add column policy_ended_on date,
  add constraint opportunities_policy_term_check check (
    policy_term_months = 12 or (policy_term_months = 6 and product_line = 'auto')
  ),
  add constraint opportunities_policy_ended_check check (policy_ended_on is null or outcome = 'won');

comment on column public.opportunities.policy_term_months is
  'Months between renewals: 12, or 6 for auto. Used to roll the renewal date forward.';
comment on column public.opportunities.policy_ended_on is
  'Set when a renewal is recorded as lost. A won opportunity with this empty is an active policy.';

-- Reopening a won opportunity (it becomes open/nurture again) clears the end date, which the
-- check above would otherwise reject. Same rules as Phase 4 otherwise.
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

  if new.product_line is distinct from old.product_line then
    raise exception 'The product line of an opportunity cannot be changed.'
      using errcode = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- Renewal outcomes (one per policy per renewal date; never edited or deleted)
-- ---------------------------------------------------------------------------
create type public.renewal_outcome as enum ('renewed', 'remarketed', 'lost');
create type public.renewal_loss_reason as enum (
  'price', 'coverage', 'other_carrier', 'no_longer_needed', 'moved_away', 'carrier_non_renewed', 'other'
);

create table public.renewal_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  opportunity_id uuid not null,
  renewal_date date not null,
  outcome public.renewal_outcome not null,
  loss_reason public.renewal_loss_reason,
  premium numeric(12, 2) check (premium >= 0),
  next_renewal_date date,
  notes text check (char_length(notes) <= 1000),
  recorded_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint renewal_outcomes_opportunity_fk foreign key (opportunity_id, owner_id)
    references public.opportunities (id, owner_id) on delete restrict,
  constraint renewal_outcomes_once_key unique (opportunity_id, renewal_date),
  constraint renewal_outcomes_loss_reason_check check ((outcome = 'lost') = (loss_reason is not null)),
  constraint renewal_outcomes_next_date_check check (
    (outcome = 'lost' and next_renewal_date is null and premium is null)
    or (outcome <> 'lost' and next_renewal_date > renewal_date)
  )
);
comment on table public.renewal_outcomes is
  'Retention history: what happened at each renewal of a policy (Phase 8). Written by record_renewal_outcome().';

create index renewal_outcomes_owner_recent_idx on public.renewal_outcomes (owner_id, created_at desc);

create trigger renewal_outcomes_touch before update on public.renewal_outcomes
  for each row execute function crm_private.touch_row();
create trigger renewal_outcomes_keep_owner before update on public.renewal_outcomes
  for each row execute function crm_private.keep_owner();
create trigger renewal_outcomes_audit after insert or update or delete on public.renewal_outcomes
  for each row execute function crm_private.write_audit_log();

-- ---------------------------------------------------------------------------
-- Cross-sell rules (configurable data) and dismissals
-- ---------------------------------------------------------------------------
create table public.cross_sell_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  rule_key text not null check (rule_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  -- The client holds an active policy in at least one of these lines...
  has_any_lines text[] not null check (
    cardinality(has_any_lines) between 1 and 4
    and has_any_lines <@ array['auto', 'home', 'commercial', 'life']
  ),
  -- ...and has no active policy, open opportunity or recent loss in this one.
  lacks_line text not null references public.product_lines (code) on delete restrict,
  -- null = individuals and businesses
  contact_type public.contact_type,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cross_sell_rules_owner_key unique (owner_id, rule_key),
  constraint cross_sell_rules_id_owner_key unique (id, owner_id),
  constraint cross_sell_rules_distinct_lines_check check (not (lacks_line = any (has_any_lines)))
);
comment on table public.cross_sell_rules is
  'Per-agent cross-sell rules (Phase 8): "holds one of these lines, lacks that one → review".';

create trigger cross_sell_rules_touch before update on public.cross_sell_rules
  for each row execute function crm_private.touch_row();
create trigger cross_sell_rules_keep_owner before update on public.cross_sell_rules
  for each row execute function crm_private.keep_owner();
create trigger cross_sell_rules_audit after insert or update or delete on public.cross_sell_rules
  for each row execute function crm_private.write_audit_log();

create table public.cross_sell_dismissals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  rule_id uuid not null,
  dismissed_on date not null,
  hidden_until date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cross_sell_dismissals_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  constraint cross_sell_dismissals_rule_fk foreign key (rule_id, owner_id)
    references public.cross_sell_rules (id, owner_id) on delete restrict,
  constraint cross_sell_dismissals_once_key unique (contact_id, rule_id),
  constraint cross_sell_dismissals_dates_check check (hidden_until > dismissed_on)
);
comment on table public.cross_sell_dismissals is
  'Cross-sell prompts the agent dismissed for a contact; hidden until hidden_until (12 months).';

create trigger cross_sell_dismissals_touch before update on public.cross_sell_dismissals
  for each row execute function crm_private.touch_row();
create trigger cross_sell_dismissals_keep_owner before update on public.cross_sell_dismissals
  for each row execute function crm_private.keep_owner();
create trigger cross_sell_dismissals_audit after insert or update or delete on public.cross_sell_dismissals
  for each row execute function crm_private.write_audit_log();

-- ---------------------------------------------------------------------------
-- Row level security, two-step requirement and privileges
-- ---------------------------------------------------------------------------
alter table public.renewal_outcomes enable row level security;
alter table public.cross_sell_rules enable row level security;
alter table public.cross_sell_dismissals enable row level security;

revoke all on public.renewal_outcomes, public.cross_sell_rules, public.cross_sell_dismissals from anon, authenticated;
-- Outcomes are history: insert and read only.
grant select, insert on public.renewal_outcomes to authenticated;
grant select, insert, update on public.cross_sell_rules, public.cross_sell_dismissals to authenticated;

create policy renewal_outcomes_select_own on public.renewal_outcomes
  for select to authenticated using (owner_id = (select auth.uid()));
create policy renewal_outcomes_insert_own on public.renewal_outcomes
  for insert to authenticated with check (owner_id = (select auth.uid()));

create policy cross_sell_rules_select_own on public.cross_sell_rules
  for select to authenticated using (owner_id = (select auth.uid()));
create policy cross_sell_rules_insert_own on public.cross_sell_rules
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy cross_sell_rules_update_own on public.cross_sell_rules
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy cross_sell_dismissals_select_own on public.cross_sell_dismissals
  for select to authenticated using (owner_id = (select auth.uid()));
create policy cross_sell_dismissals_insert_own on public.cross_sell_dismissals
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy cross_sell_dismissals_update_own on public.cross_sell_dismissals
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy renewal_outcomes_require_mfa on public.renewal_outcomes
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy cross_sell_rules_require_mfa on public.cross_sell_rules
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy cross_sell_dismissals_require_mfa on public.cross_sell_dismissals
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Default cross-sell rules for every profile (new and existing)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as the default automation rules: it runs inside the
-- sign-up path, where the inserting role is not the new user.
create function crm_private.insert_default_cross_sell_rules(p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cross_sell_rules (owner_id, rule_key, name, has_any_lines, lacks_line, contact_type, reason)
  values
    (p_owner, 'auto_no_home', 'Auto client without home', array['auto'], 'home', 'individual',
     'Has auto with you but no home policy. Ask about their home or renters coverage.'),
    (p_owner, 'home_no_auto', 'Home client without auto', array['home'], 'auto', 'individual',
     'Has home with you but no auto policy. Ask who insures their vehicles.'),
    (p_owner, 'personal_no_life', 'Auto or home client without life', array['auto', 'home'], 'life', 'individual',
     'Has auto or home with you but no life policy. Review their life insurance needs.'),
    (p_owner, 'commercial_no_life', 'Commercial client without life', array['commercial'], 'life', 'business',
     'Commercial client with no life policy. Review key person or buy-sell coverage.')
  on conflict (owner_id, rule_key) do nothing;
$$;

create function crm_private.create_default_cross_sell_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm_private.insert_default_cross_sell_rules(new.id);
  return new;
end;
$$;

revoke all on function crm_private.insert_default_cross_sell_rules(uuid) from public, anon, authenticated;
revoke all on function crm_private.create_default_cross_sell_rules() from public, anon, authenticated;

create trigger profiles_default_cross_sell_rules after insert on public.profiles
  for each row execute function crm_private.create_default_cross_sell_rules();

select crm_private.insert_default_cross_sell_rules(p.id) from public.profiles p;

-- ---------------------------------------------------------------------------
-- Automation: renewal reviews per term; none for an ended policy
-- ---------------------------------------------------------------------------
-- Same as Phase 6 except the renewal review. Its key names the renewal period: the year for
-- 12-month policies (as before, so existing tasks keep matching), and the half year for
-- 6-month auto policies (two renewals a year). Correcting a date within the same period moves
-- the open task; the next period gets a new task.
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
    -- New lead: only when the opportunity starts at the first stage of its pipeline.
    select s.position = 1 into first_stage from public.pipeline_stages s where s.id = new.stage_id;
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

-- ---------------------------------------------------------------------------
-- Data API functions
-- ---------------------------------------------------------------------------

-- Renewals view. Policies (won, still active) renewing within p_days, plus any whose renewal
-- date has passed with no outcome recorded (the date only moves on when one is). Prospects'
-- current policies (open/nurture opportunities with a renewal date) are listed too, for
-- timing the quote; they have no retention outcome.
create function public.search_renewals(
  p_today date,
  p_days integer default 60,
  p_product_line text default null
)
returns table (
  id uuid,
  contact_id uuid,
  product_line text,
  outcome public.opportunity_outcome,
  renewal_date date,
  policy_term_months smallint,
  estimated_annual_premium numeric,
  quoted_carrier text,
  review_task_id uuid,
  review_due_date date,
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text,
  phone text
)
language sql
stable
set search_path = ''
as $$
  select o.id, o.contact_id, o.product_line, o.outcome, o.renewal_date, o.policy_term_months,
    o.estimated_annual_premium, o.quoted_carrier, t.id, t.due_date,
    c.contact_type, c.first_name, c.last_name, c.business_name, c.phone
  from public.opportunities o
  join public.contacts c on c.id = o.contact_id
  left join lateral (
    select x.id, x.due_date from public.tasks x
    where x.opportunity_id = o.id and x.category = 'renewal' and x.status = 'open'
    order by x.due_date, x.id
    limit 1
  ) t on true
  where o.renewal_date is not null
    and o.renewal_date <= p_today + least(greatest(coalesce(p_days, 60), 1), 366)
    and (
      (o.outcome = 'won' and o.policy_ended_on is null)
      or (o.outcome in ('open', 'nurture') and o.renewal_date >= p_today)
    )
    and (p_product_line is null or o.product_line = p_product_line)
  order by o.renewal_date, o.id
  limit 200;
$$;

comment on function public.search_renewals is
  'Renewals view (Phase 8). SECURITY INVOKER: RLS limits results to the caller''s own records.';

-- Records what happened at a policy's renewal, in one transaction:
--   renewed / remarketed: outcome row; renewal date rolls forward by the term (the automation
--     trigger then creates the next review); premium updated when given.
--   lost: outcome row with a reason; the policy ends; the contact becomes a former client if
--     they hold no other active policy.
-- Either way the open automatic renewal review for this policy is completed.
create function public.record_renewal_outcome(
  p_opportunity_id uuid,
  p_outcome public.renewal_outcome,
  p_loss_reason public.renewal_loss_reason default null,
  p_premium numeric default null,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  o public.opportunities;
  next_date date;
  became_former boolean := false;
begin
  select * into o from public.opportunities where id = p_opportunity_id for update;
  if not found then
    raise exception 'Policy not found.' using errcode = 'no_data_found';
  end if;
  if o.outcome <> 'won' or o.policy_ended_on is not null or o.renewal_date is null then
    raise exception 'Only an active policy with a renewal date can have a renewal outcome.'
      using errcode = 'check_violation';
  end if;

  if p_outcome <> 'lost' then
    next_date := (o.renewal_date + make_interval(months => o.policy_term_months))::date;
  end if;

  insert into public.renewal_outcomes
    (owner_id, opportunity_id, renewal_date, outcome, loss_reason, premium, next_renewal_date, notes, recorded_on)
  values
    (o.owner_id, o.id, o.renewal_date, p_outcome, p_loss_reason,
     case when p_outcome <> 'lost' then p_premium end, next_date,
     nullif(btrim(p_notes), ''), crm_engine.user_today());

  update public.tasks
     set status = 'completed'
   where opportunity_id = o.id and category = 'renewal' and origin = 'automation' and status = 'open';

  if p_outcome = 'lost' then
    update public.opportunities set policy_ended_on = o.renewal_date where id = o.id;
    if not exists (
      select 1 from public.opportunities x
      where x.contact_id = o.contact_id and x.outcome = 'won' and x.policy_ended_on is null
    ) then
      update public.contacts set relationship_status = 'former_client'
       where id = o.contact_id and relationship_status <> 'former_client';
      became_former := found;
    end if;
  else
    update public.opportunities
       set renewal_date = next_date,
           estimated_annual_premium = coalesce(p_premium, estimated_annual_premium)
     where id = o.id;
  end if;

  return jsonb_build_object('next_renewal_date', next_date, 'contact_now_former_client', became_former);
end;
$$;

comment on function public.record_renewal_outcome is
  'Retention workflow (Phase 8): records a renewal outcome and updates the policy. SECURITY INVOKER.';

-- Cross-sell prompts: for each enabled rule, contacts holding an active policy in one of the
-- rule's lines and nothing in the line it suggests (no active policy, no open or nurture
-- opportunity, no opportunity lost in the last 12 months), unless dismissed and still hidden.
create function public.cross_sell_prompts(
  p_today date,
  p_contact_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  contact_id uuid,
  rule_id uuid,
  rule_key text,
  rule_name text,
  reason text,
  lacks_line text,
  held_lines text[],
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text
)
language sql
stable
set search_path = ''
as $$
  with held as (
    select o.contact_id, array_agg(distinct o.product_line order by o.product_line) as lines
    from public.opportunities o
    where o.outcome = 'won' and o.policy_ended_on is null
      and (p_contact_id is null or o.contact_id = p_contact_id)
    group by o.contact_id
  )
  select c.id, r.id, r.rule_key, r.name, r.reason, r.lacks_line, h.lines,
    c.contact_type, c.first_name, c.last_name, c.business_name
  from held h
  join public.contacts c on c.id = h.contact_id
  join public.cross_sell_rules r
    on r.enabled
   and h.lines && r.has_any_lines
   and not (r.lacks_line = any (h.lines))
   and (r.contact_type is null or r.contact_type = c.contact_type)
  where c.archived_at is null
    and not exists (
      select 1 from public.opportunities x
      where x.contact_id = c.id and x.product_line = r.lacks_line
        and (x.outcome in ('open', 'nurture')
             or (x.outcome = 'lost' and x.closed_at > (p_today - 365)::timestamptz))
    )
    and not exists (
      select 1 from public.cross_sell_dismissals d
      where d.contact_id = c.id and d.rule_id = r.id and d.hidden_until > p_today
    )
  order by lower(coalesce(c.business_name, c.last_name, c.first_name, '')), c.id, r.rule_key
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.cross_sell_prompts is
  'Cross-sell review prompts (Phase 8). SECURITY INVOKER: RLS limits results to the caller''s own records.';

-- Hides one prompt for one contact for 12 months (from today in the user's time zone).
-- Dismissing again after it reappears restarts the 12 months. Returns rows written (0 or 1).
create function public.dismiss_cross_sell(p_contact_id uuid, p_rule_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  today date := crm_engine.user_today();
  written integer;
begin
  insert into public.cross_sell_dismissals (contact_id, rule_id, dismissed_on, hidden_until)
  select c.id, r.id, today, (today + interval '12 months')::date
  from public.contacts c, public.cross_sell_rules r
  where c.id = p_contact_id and r.id = p_rule_id
  on conflict (contact_id, rule_id) do update
    set dismissed_on = excluded.dismissed_on, hidden_until = excluded.hidden_until;
  get diagnostics written = row_count;
  return written;
end;
$$;

comment on function public.dismiss_cross_sell is
  'Hides a cross-sell prompt for a contact for 12 months (Phase 8). SECURITY INVOKER.';

-- Dashboard: an ended policy is no longer an upcoming renewal. Otherwise as in Phase 7.
create or replace function public.dashboard_summary(p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tasks', (
      select jsonb_build_object(
        'overdue', count(*) filter (where t.due_date < p_today),
        'due_today', count(*) filter (where t.due_date = p_today),
        'upcoming_7_days', count(*) filter (where t.due_date > p_today and t.due_date <= p_today + 7)
      )
      from public.tasks t
      where t.status = 'open'
    ),
    'open_by_line', coalesce((
      select jsonb_agg(row_to_json(x) order by x.product_line)
      from (
        select o.product_line,
          count(*) filter (where o.outcome = 'open') as open_count,
          count(*) filter (where o.outcome = 'nurture') as nurture_count,
          coalesce(sum(o.estimated_annual_premium), 0) as premium
        from public.opportunities o
        where o.outcome in ('open', 'nurture')
        group by o.product_line
      ) x
    ), '[]'::jsonb),
    'renewals', jsonb_build_object(
      'next_60_days', (
        select count(*) from public.opportunities o
        where o.renewal_date between p_today and p_today + 60 and o.outcome <> 'lost'
          and o.policy_ended_on is null
      ),
      'soonest', coalesce((
        select jsonb_agg(row_to_json(r) order by r.renewal_date, r.id)
        from (
          select o.id, o.product_line, o.renewal_date, o.outcome,
            c.contact_type, c.first_name, c.last_name, c.business_name
          from public.opportunities o
          join public.contacts c on c.id = o.contact_id
          where o.renewal_date between p_today and p_today + 60 and o.outcome <> 'lost'
            and o.policy_ended_on is null
          order by o.renewal_date, o.id
          limit 5
        ) r
      ), '[]'::jsonb)
    ),
    'recent_activity', coalesce((
      select jsonb_agg(row_to_json(a) order by a.occurred_at desc, a.id)
      from (
        select x.id, x.contact_id, x.activity_type, x.outcome, x.occurred_at, x.notes,
          c.contact_type, c.first_name, c.last_name, c.business_name
        from public.activities x
        join public.contacts c on c.id = x.contact_id
        order by x.occurred_at desc, x.id
        limit 8
      ) a
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.search_renewals(date, integer, text) from public, anon;
revoke all on function public.record_renewal_outcome(uuid, public.renewal_outcome, public.renewal_loss_reason, numeric, text) from public, anon;
revoke all on function public.cross_sell_prompts(date, uuid, integer, integer) from public, anon;
revoke all on function public.dismiss_cross_sell(uuid, uuid) from public, anon;
grant execute on function public.search_renewals(date, integer, text) to authenticated;
grant execute on function public.record_renewal_outcome(uuid, public.renewal_outcome, public.renewal_loss_reason, numeric, text) to authenticated;
grant execute on function public.cross_sell_prompts(date, uuid, integer, integer) to authenticated;
grant execute on function public.dismiss_cross_sell(uuid, uuid) to authenticated;
