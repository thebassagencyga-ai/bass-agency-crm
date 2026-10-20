-- Phase 27 (ADR-045): ProducrIQ Focus, workflow audit Step 3 (owner decisions 3, 5, 6, 7 of
-- 2026-10-19; design approved 2026-10-20, with lost deals re-quoted and referrers thanked when
-- the referred person arrives).
--
-- 1. Opportunities: when the stage last changed (for "gone quiet"), a nurture check-back date,
--    and a Focus snooze date. The current carrier and renewal date already exist (Phase 13).
-- 2. Three automation rules per agent: nurture check-back, re-quote 45 days before a prospect's
--    current policy renews, and thank the referrer. Each task has a deterministic key, so
--    retries and date changes never duplicate one.
-- 3. One-time: re-quote tasks for deals that already have a future renewal date.
-- 4. focus_list(today): the read-only Focus list, one call, SECURITY INVOKER (RLS applies).
--
-- No new tables, no deletes, no new anonymous access. Deterministic rules only; no AI.

-- ---------------------------------------------------------------------------
-- 1. Opportunity columns
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column stage_changed_at timestamptz,
  add column nurture_check_back_on date,
  add column focus_snoozed_until date;
comment on column public.opportunities.stage_changed_at is
  'When the stage or outcome last changed (set by trigger). Before Phase 27: the last update time.';
comment on column public.opportunities.nurture_check_back_on is
  'Nurture only: the date to check back (the agent''s choice). Cleared when the deal leaves nurture.';
comment on column public.opportunities.focus_snoozed_until is
  'Open deals only: hidden from Focus "gone quiet" until this date. Cleared when the deal is no longer open.';

-- Existing deals start from their last update. Only the new column changes: "last updated" is
-- kept (touch trigger paused); the audit log records each row.
alter table public.opportunities disable trigger opportunities_touch;
update public.opportunities set stage_changed_at = updated_at;
alter table public.opportunities enable trigger opportunities_touch;
alter table public.opportunities
  alter column stage_changed_at set default now(),
  alter column stage_changed_at set not null;

create function crm_private.opportunity_focus_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := now();
  elsif new.stage_id is distinct from old.stage_id or new.outcome is distinct from old.outcome then
    new.stage_changed_at := now();
  else
    new.stage_changed_at := old.stage_changed_at;
  end if;
  if new.outcome <> 'nurture' then
    new.nurture_check_back_on := null;
  end if;
  if new.outcome <> 'open' then
    new.focus_snoozed_until := null;
  end if;
  return new;
end;
$$;
revoke all on function crm_private.opportunity_focus_fields() from public, anon, authenticated;

create trigger opportunities_focus_fields before insert or update on public.opportunities
  for each row execute function crm_private.opportunity_focus_fields();

-- ---------------------------------------------------------------------------
-- 2. Rules: three new defaults for every agent (existing and future)
-- ---------------------------------------------------------------------------
create function crm_private.insert_focus_rules(p_owner uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.automation_rules
    (owner_id, rule_key, name, trigger_event, action, anchor, offset_days, day_count,
     task_title_template, task_priority, task_category, completion_window_days, cooldown_days, config)
  values
    (p_owner, 'nurture_check_back', 'Nurture: check back on the date you choose',
     'nurture_started', 'create_task', 'requested_date', 0, 'calendar',
     'Check back (nurture)', 'normal', 'prospecting', 0, null, '{}'),
    -- Category "other": never closed by a win or loss (a lost deal is re-quoted, owner
    -- 2026-10-20), and kept out of the policy renewal-review counts.
    (p_owner, 'prospect_requote', 'Re-quote before a prospect''s current policy renews',
     'current_policy_renewal_known', 'create_task', 'renewal_date', -45, 'calendar',
     'Re-quote before their current policy renews', 'normal', 'other', 0, null, '{}'),
    -- A personal call or note only: no gifts, incentives or rewards (ADR-013, ADR-039).
    (p_owner, 'referrer_thank_you', 'Referral received: thank the referrer',
     'referral_received', 'create_task', 'event_date', 0, 'calendar',
     'Thank {referrer_name} for referring {referred_name}', 'normal', 'other', 0, null, '{}')
  on conflict (owner_id, rule_key) do nothing;
$$;
revoke all on function crm_private.insert_focus_rules(uuid) from public, anon, authenticated;

select crm_private.insert_focus_rules(p.id) from public.profiles p;

-- New agents: inserted with the other defaults when the profile is created (sign-up runs as
-- the auth service, so this trigger function is SECURITY DEFINER like the original).
create function crm_private.create_focus_automation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm_private.insert_focus_rules(new.id);
  return new;
end;
$$;
revoke all on function crm_private.create_focus_automation_rules() from public, anon, authenticated;

create trigger profiles_focus_automation_rules after insert on public.profiles
  for each row execute function crm_private.create_focus_automation_rules();

-- ---------------------------------------------------------------------------
-- Engine helpers (SECURITY INVOKER, like the rest of crm_engine)
-- ---------------------------------------------------------------------------

-- Cancels an opportunity's open tasks from one rule, except the one with p_keep_key.
create function crm_engine.cancel_rule_tasks(p_opportunity_id uuid, p_rule_key text, p_keep_key text default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  closed integer;
begin
  update public.tasks t
     set status = 'cancelled'
   where t.opportunity_id = p_opportunity_id and t.status = 'open'
     and t.dedupe_key is distinct from p_keep_key
     and t.automation_rule_id in (
       select r.id from public.automation_rules r where r.owner_id = t.owner_id and r.rule_key = p_rule_key
     );
  get diagnostics closed = row_count;
  return closed;
end;
$$;

-- A contact's name as shown in the app: "First Last", or the business name.
create function crm_engine.contact_name(c public.contacts)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when c.contact_type = 'business' then coalesce(btrim(c.business_name), '')
              else btrim(concat_ws(' ', btrim(c.first_name), btrim(c.last_name))) end;
$$;

-- The thank-you task for whoever referred p_referred: one per referred person (its key), on the
-- referrer's contact, the title naming both. Returns the number of tasks written (0 or 1).
create function crm_engine.thank_referrer(p_referred uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.automation_rules;
  c public.contacts;
  ref public.contacts;
  start_on date;
begin
  select * into r from public.automation_rules where owner_id = auth.uid() and rule_key = 'referrer_thank_you';
  if not found or not r.enabled or r.action <> 'create_task' then
    return 0;
  end if;
  select * into c from public.contacts where id = p_referred;
  if not found or c.referred_by_contact_id is null then
    return 0;
  end if;
  select * into ref from public.contacts where id = c.referred_by_contact_id;
  if not found then
    return 0;
  end if;
  start_on := greatest(crm_engine.user_today() + r.offset_days, crm_engine.user_today());
  return crm_engine.upsert_task(
    r, ref.id, null,
    replace(replace(r.task_title_template, '{referrer_name}', crm_engine.contact_name(ref)), '{referred_name}', crm_engine.contact_name(c)),
    start_on, start_on + r.completion_window_days,
    'contact:' || c.id || ':rule:referrer_thank_you');
end;
$$;

revoke all on function crm_engine.cancel_rule_tasks(uuid, text, text) from public, anon;
revoke all on function crm_engine.contact_name(public.contacts) from public, anon;
revoke all on function crm_engine.thank_referrer(uuid) from public, anon;
grant execute on function crm_engine.cancel_rule_tasks(uuid, text, text) to authenticated;
grant execute on function crm_engine.contact_name(public.contacts) to authenticated;
grant execute on function crm_engine.thank_referrer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Opportunity automation: Phase 25 version plus nurture check-back and re-quote
-- ---------------------------------------------------------------------------
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
  key text;
  n integer;
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

  -- Phase 27. Nurture check-back: one task per nurture period, on the date the agent chose; a
  -- new date moves it; leaving nurture cancels it.
  if tg_op = 'UPDATE' and old.outcome = 'nurture' and new.outcome <> 'nurture' then
    perform crm_engine.cancel_rule_tasks(new.id, 'nurture_check_back');
  elsif new.outcome = 'nurture' and new.nurture_check_back_on is not null
     and (tg_op = 'INSERT' or old.outcome <> 'nurture' or new.nurture_check_back_on is distinct from old.nurture_check_back_on) then
    select t.dedupe_key into key
      from public.tasks t join public.automation_rules r on r.id = t.automation_rule_id
     where t.opportunity_id = new.id and t.status = 'open' and r.rule_key = 'nurture_check_back'
     order by t.created_at desc limit 1;
    if key is null then
      select count(*) into n
        from public.tasks t join public.automation_rules r on r.id = t.automation_rule_id
       where t.opportunity_id = new.id and r.rule_key = 'nurture_check_back';
      key := k || 'nurture_check_back:cycle:' || new.cycle || ':' || (n + 1);
    end if;
    perform crm_engine.apply_rule('nurture_check_back', new.contact_id, new.id, new.nurture_check_back_on, key);
  end if;

  -- Phase 27. Re-quote before a prospect's current policy renews: any deal not won (lost ones
  -- included, owner 2026-10-20), never for imported records, never dated in the past (due today
  -- when closer than the rule's days), none once the renewal date has passed. One task per
  -- renewal year; a corrected date moves it; a win or a cleared date cancels it.
  if tg_op = 'INSERT' or new.current_policy_renews_on is distinct from old.current_policy_renews_on
     or (new.outcome = 'won' and old.outcome <> 'won') then
    if new.outcome <> 'won' and not new.existing_policy and new.import_batch_id is null
       and new.current_policy_renews_on is not null and new.current_policy_renews_on >= today then
      key := k || 'prospect_requote:renews:' || extract(year from new.current_policy_renews_on)::integer;
      if tg_op = 'UPDATE' then
        perform crm_engine.cancel_rule_tasks(new.id, 'prospect_requote', key);
      end if;
      perform crm_engine.apply_rule('prospect_requote', new.contact_id, new.id, new.current_policy_renews_on, key);
    elsif tg_op = 'UPDATE' then
      perform crm_engine.cancel_rule_tasks(new.id, 'prospect_requote');
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Referrer thank-you: when a contact first gets a "Referred by" link. Checked at commit
-- (deferred), so a merge (which fills the kept contact's blank referrer from the duplicate,
-- already thanked for) is recognised by then. Imported, merged and archived contacts get none.
-- ---------------------------------------------------------------------------
create function crm_private.contact_referral_thanks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
begin
  if tg_op = 'UPDATE' and old.referred_by_contact_id is not null then
    return null;
  end if;
  select * into c from public.contacts where id = new.id;
  if not found or c.referred_by_contact_id is null or c.import_batch_id is not null
     or c.merged_into_contact_id is not null or c.archived_at is not null then
    return null;
  end if;
  if exists (
    select 1 from public.contacts m
    where m.merged_into_contact_id = c.id and m.referred_by_contact_id = c.referred_by_contact_id
  ) then
    return null;
  end if;
  perform crm_engine.thank_referrer(c.id);
  return null;
end;
$$;
revoke all on function crm_private.contact_referral_thanks() from public, anon, authenticated;

create constraint trigger contacts_referral_thanks
  after insert or update of referred_by_contact_id on public.contacts
  deferrable initially deferred
  for each row execute function crm_private.contact_referral_thanks();

-- ---------------------------------------------------------------------------
-- 3. One-time: re-quote tasks for deals that already have a future renewal date (same rules as
--    the trigger; kept as a function so it is tested; not callable by the app).
-- ---------------------------------------------------------------------------
create function crm_private.create_missing_requote_tasks()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  created integer;
begin
  insert into public.tasks (owner_id, contact_id, opportunity_id, title, due_date, priority, category,
    origin, automation_rule_id, dedupe_key)
  select o.owner_id, o.contact_id, o.id, r.task_title_template,
    greatest(o.current_policy_renews_on + r.offset_days, x.today), r.task_priority, r.task_category,
    'automation', r.id,
    'opp:' || o.id || ':rule:prospect_requote:renews:' || extract(year from o.current_policy_renews_on)::integer
  from public.opportunities o
  join public.profiles p on p.id = o.owner_id
  cross join lateral (select (now() at time zone coalesce(p.time_zone, 'America/New_York'))::date as today) x
  join public.automation_rules r on r.owner_id = o.owner_id and r.rule_key = 'prospect_requote' and r.enabled
  join public.contacts c on c.id = o.contact_id
  where o.outcome <> 'won' and not o.existing_policy and o.import_batch_id is null
    and o.current_policy_renews_on is not null and o.current_policy_renews_on >= x.today
    and c.archived_at is null
  on conflict (owner_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;
revoke all on function crm_private.create_missing_requote_tasks() from public, anon, authenticated;

do $$
declare
  n integer := crm_private.create_missing_requote_tasks();
begin
  raise notice 'Phase 27: % re-quote task(s) created for existing deals.', n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. focus_list(today): the Focus list on the Today page
-- ---------------------------------------------------------------------------
-- "Meaningful activity" (owner decision 3): the deal being added, a stage or outcome change, a
-- quote date, or any logged activity with the contact except review and referral asks.
create function public.focus_list(p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with tz as (
    select coalesce((select p.time_zone from public.profiles p where p.id = auth.uid()), 'America/New_York') as name
  ),
  deals as (
    select o.id as opportunity_id, o.contact_id, o.product_line, o.outcome, o.estimated_annual_premium,
      o.quote_sent_on, o.nurture_check_back_on, o.focus_snoozed_until, o.current_carrier,
      o.current_policy_renews_on, o.loss_reason,
      s.name as stage_name, s.is_quote_stage,
      c.contact_type, c.first_name, c.last_name, c.business_name, c.phone, c.email,
      greatest(
        (o.created_at at time zone tz.name)::date,
        (o.stage_changed_at at time zone tz.name)::date,
        o.quote_sent_on,
        (select (max(a.occurred_at) at time zone tz.name)::date from public.activities a
          where a.contact_id = o.contact_id and a.activity_type not in ('review_request', 'referral_request'))
      ) as last_touch_on
    from public.opportunities o
    cross join tz
    join public.stages s on s.id = o.stage_id
    join public.contacts c on c.id = o.contact_id
    where o.outcome in ('open', 'nurture') and o.import_batch_id is null and c.archived_at is null
  ),
  quiet as (
    select d.*, p_today - d.last_touch_on as days_quiet,
      case when d.is_quote_stage then 'quote' else 'open' end as kind
    from deals d
    where d.outcome = 'open'
      and (d.focus_snoozed_until is null or d.focus_snoozed_until <= p_today)
      and p_today - d.last_touch_on >= case when d.is_quote_stage then 3 else 7 end
  ),
  rule_tasks as (
    select r.rule_key, t.id as task_id, t.title, t.due_date, t.contact_id, t.opportunity_id,
      o.product_line, o.outcome, o.current_carrier, o.current_policy_renews_on, o.loss_reason,
      c.contact_type, c.first_name, c.last_name, c.business_name, c.phone, c.email
    from public.tasks t
    join public.automation_rules r on r.id = t.automation_rule_id
    join public.contacts c on c.id = t.contact_id
    left join public.opportunities o on o.id = t.opportunity_id
    where t.status = 'open' and t.due_date <= p_today and coalesce(t.start_date, t.due_date) <= p_today
      and r.rule_key in ('prospect_requote', 'referrer_thank_you') and c.archived_at is null
  )
  select jsonb_build_object(
    'today', p_today,
    'quiet_quotes', coalesce((
      select jsonb_agg(to_jsonb(x) - 'kind' - 'is_quote_stage' - 'nurture_check_back_on' - 'outcome' order by x.days_quiet desc, x.opportunity_id)
      from (select * from quiet where kind = 'quote' order by days_quiet desc, opportunity_id limit 100) x
    ), '[]'::jsonb),
    'quiet_open', coalesce((
      select jsonb_agg(to_jsonb(x) - 'kind' - 'is_quote_stage' - 'nurture_check_back_on' - 'outcome' order by x.days_quiet desc, x.opportunity_id)
      from (select * from quiet where kind = 'open' order by days_quiet desc, opportunity_id limit 100) x
    ), '[]'::jsonb),
    'nurture', coalesce((
      select jsonb_agg(to_jsonb(x) - 'is_quote_stage' - 'focus_snoozed_until' - 'outcome' order by x.nurture_check_back_on nulls last, x.opportunity_id)
      from (
        select * from deals
        where outcome = 'nurture' and (nurture_check_back_on is null or nurture_check_back_on <= p_today)
        order by nurture_check_back_on nulls last, opportunity_id limit 100
      ) x
    ), '[]'::jsonb),
    'requote', coalesce((
      select jsonb_agg(to_jsonb(x) - 'rule_key' order by x.due_date, x.task_id)
      from (select * from rule_tasks where rule_key = 'prospect_requote' order by due_date, task_id limit 100) x
    ), '[]'::jsonb),
    'thanks', coalesce((
      select jsonb_agg(to_jsonb(x) - 'rule_key' - 'product_line' - 'outcome' - 'current_carrier' - 'current_policy_renews_on' - 'loss_reason' order by x.due_date, x.task_id)
      from (select * from rule_tasks where rule_key = 'referrer_thank_you' order by due_date, task_id limit 100) x
    ), '[]'::jsonb)
  );
$$;

comment on function public.focus_list(date) is
  'Phase 27 Focus list (ADR-045): quiet quotes (3+ days), other quiet open deals (7+), nurture check-backs due or undated, due re-quote and referrer thank-you tasks. Read-only; SECURITY INVOKER.';
revoke all on function public.focus_list(date) from public, anon;
grant execute on function public.focus_list(date) to authenticated;
