-- Phase 6: automation engine (ADR-008, ADR-013, ADR-022).
--
-- Events are detected by AFTER triggers on opportunities, tasks and activities, so the change
-- and the tasks it causes commit together (one transaction, no scheduler). Everything runs as
-- the signed-in user — SECURITY INVOKER throughout — so row level security (owner + two-step)
-- applies to every row read or written. No function here bypasses RLS.
--
-- The engine lives in its own schema, crm_engine, which the API does not expose. Only the
-- `authenticated` role may use it (needed because triggers run as the caller); `anon` cannot.
-- crm_private stays closed to API roles.
--
-- Duplicate safety: every automatic task has a deterministic dedupe_key, unique per owner
-- across all statuses. A repeated event updates the existing open task's dates (unless the
-- owner changed the date: due_date_overridden) and never creates a second task.

create schema crm_engine;
revoke all on schema crm_engine from public;
grant usage on schema crm_engine to authenticated;
comment on schema crm_engine is 'Automation engine (Phase 6). SECURITY INVOKER only; not exposed by the Data API.';

-- Today's date in the signed-in user's time zone (ADR-007).
create function crm_engine.user_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.time_zone from public.profiles p where p.id = auth.uid()),
    'America/New_York'
  ))::date;
$$;

-- Adds business days (Monday–Friday; US holidays are not skipped, ADR-007).
create function crm_engine.add_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  result date := p_date;
  step integer := sign(p_days)::integer;
  remaining integer := abs(p_days);
begin
  while remaining > 0 loop
    result := result + step;
    if extract(isodow from result) < 6 then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

create function crm_engine.rule_enabled(p_rule_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select r.enabled from public.automation_rules r where r.owner_id = auth.uid() and r.rule_key = p_rule_key),
    false
  );
$$;

-- Inserts an automatic task, or updates the dates of the open, not-overridden task that
-- already has this key. Returns the number of rows written (0 or 1).
create function crm_engine.upsert_task(
  r public.automation_rules,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_title text,
  p_start date,
  p_due date,
  p_key text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  written integer;
begin
  insert into public.tasks (
    owner_id, contact_id, opportunity_id, title, due_date, start_date,
    priority, category, origin, automation_rule_id, dedupe_key
  )
  values (
    r.owner_id, p_contact_id, p_opportunity_id, left(p_title, 200), p_due,
    case when p_start < p_due then p_start end,
    r.task_priority, r.task_category, 'automation', r.id, p_key
  )
  on conflict (owner_id, dedupe_key) where dedupe_key is not null do update
    set due_date = excluded.due_date, start_date = excluded.start_date
    where public.tasks.status = 'open'
      and not public.tasks.due_date_overridden
      and (public.tasks.due_date, public.tasks.start_date) is distinct from (excluded.due_date, excluded.start_date);
  get diagnostics written = row_count;
  return written;
end;
$$;

-- Applies one rule of the caller's to a contact (and optionally an opportunity).
-- p_anchor is the event date, requested date or renewal date the rule's offset counts from.
create function crm_engine.apply_rule(
  p_rule_key text,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_anchor date,
  p_key text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r public.automation_rules;
  c public.contacts;
  o public.opportunities;
  today date := crm_engine.user_today();
  start_on date;
  due_on date;
  item text;
  item_no integer := 0;
  written integer := 0;
begin
  select * into r from public.automation_rules where owner_id = auth.uid() and rule_key = p_rule_key;
  if not found or not r.enabled or p_anchor is null then
    return 0;
  end if;

  select * into c from public.contacts where id = p_contact_id;
  if not found then
    return 0;
  end if;

  if p_opportunity_id is not null then
    select * into o from public.opportunities where id = p_opportunity_id;
    if not found then
      return 0;
    end if;
    if r.product_line is not null and r.product_line <> o.product_line then
      return 0;
    end if;
    -- No prospecting reminders once an opportunity is won or lost.
    if r.task_category = 'prospecting' and o.outcome in ('won', 'lost') then
      return 0;
    end if;
  end if;

  if coalesce((r.config ->> 'skip_if_review_left')::boolean, false) and c.google_review_left_on is not null then
    return 0;
  end if;

  start_on := case
    when r.day_count = 'business' then crm_engine.add_business_days(p_anchor, r.offset_days)
    else p_anchor + r.offset_days
  end;
  -- Never schedule into the past (e.g. a renewal less than 60 days away): due today instead.
  start_on := greatest(start_on, today);
  due_on := start_on + r.completion_window_days;

  if r.action = 'create_checklist' then
    for item in select jsonb_array_elements_text(coalesce(r.config -> 'items', '[]'::jsonb)) loop
      item_no := item_no + 1;
      written := written + crm_engine.upsert_task(r, c.id, p_opportunity_id, item, start_on, due_on, p_key || ':item:' || item_no);
    end loop;
    return written;
  end if;

  if r.action <> 'create_task' then
    return 0;
  end if;

  -- Cooldown (e.g. one review request per contact per 365 days). A retry of the same event
  -- (same key) is not blocked: it updates the task it created.
  if r.cooldown_days is not null
     and not exists (select 1 from public.tasks t where t.owner_id = r.owner_id and t.dedupe_key = p_key)
     and exists (
       select 1 from public.tasks t
       where t.owner_id = r.owner_id and t.automation_rule_id = r.id and t.contact_id = c.id
         and t.created_at > now() - make_interval(days => r.cooldown_days)
     ) then
    return 0;
  end if;

  return crm_engine.upsert_task(r, c.id, p_opportunity_id, r.task_title_template, start_on, due_on, p_key);
end;
$$;

-- Won or lost: cancel the opportunity's open prospecting tasks. Onboarding, renewal, review
-- and referral tasks are left alone. Returns the number of tasks closed.
create function crm_engine.close_prospecting(p_opportunity_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  closed integer;
begin
  update public.tasks
     set status = 'cancelled'
   where opportunity_id = p_opportunity_id and category = 'prospecting' and status = 'open';
  get diagnostics closed = row_count;
  return closed;
end;
$$;

revoke all on all functions in schema crm_engine from public, anon;
grant execute on all functions in schema crm_engine to authenticated;

-- ---------------------------------------------------------------------------
-- Event triggers
-- ---------------------------------------------------------------------------

create function crm_private.opportunity_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := crm_engine.user_today();
  k text := 'opp:' || new.id || ':rule:';
  first_stage boolean;
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

  -- Renewal date known or changed: one review per renewal year (a new year means a new task).
  if new.renewal_date is not null and (tg_op = 'INSERT' or new.renewal_date is distinct from old.renewal_date) then
    perform crm_engine.apply_rule('renewal_review', new.contact_id, new.id, new.renewal_date,
      k || 'renewal_review:renewal:' || extract(year from new.renewal_date)::integer);
  end if;
  return null;
end;
$$;

-- Initial contact made (the automatic first-contact task completed) and still no quote:
-- follow up in 2 business days.
create function crm_private.task_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rk text;
  o public.opportunities;
begin
  if new.status = 'completed' and old.status <> 'completed'
     and new.origin = 'automation' and new.opportunity_id is not null then
    select r.rule_key into rk from public.automation_rules r where r.id = new.automation_rule_id;
    if rk in ('new_lead_initial_contact', 'reopened_restart') then
      select * into o from public.opportunities where id = new.opportunity_id;
      if found and o.outcome in ('open', 'nurture') and o.quote_sent_on is null then
        perform crm_engine.apply_rule('contacted_no_quote_follow_up', new.contact_id, o.id, crm_engine.user_today(),
          'opp:' || o.id || ':rule:contacted_no_quote_follow_up:cycle:' || o.cycle);
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- Activity outcomes: a prospect-requested date, or no response (which may need the owner's
-- confirmation first: rule config confirm_before_creating).
create function crm_private.activity_automation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  confirm boolean;
begin
  if new.outcome = 'requested_follow_up' and new.requested_follow_up_on is not null then
    perform crm_engine.apply_rule('requested_follow_up', new.contact_id, new.opportunity_id, new.requested_follow_up_on,
      'act:' || new.id || ':rule:requested_follow_up');
  elsif new.outcome in ('no_response', 'no_answer') then
    select coalesce((r.config ->> 'confirm_before_creating')::boolean, false) into confirm
      from public.automation_rules r where r.owner_id = auth.uid() and r.rule_key = 'no_response_follow_up';
    if not coalesce(confirm, false) then
      perform crm_engine.apply_rule('no_response_follow_up', new.contact_id, new.opportunity_id, crm_engine.user_today(),
        'act:' || new.id || ':rule:no_response_follow_up');
    end if;
  end if;
  return null;
end;
$$;

revoke all on function crm_private.opportunity_automation() from public, anon, authenticated;
revoke all on function crm_private.task_automation() from public, anon, authenticated;
revoke all on function crm_private.activity_automation() from public, anon, authenticated;

create trigger opportunities_automation after insert or update on public.opportunities
  for each row execute function crm_private.opportunity_automation();
create trigger tasks_automation after update of status on public.tasks
  for each row execute function crm_private.task_automation();
create trigger activities_automation after insert on public.activities
  for each row execute function crm_private.activity_automation();

-- ---------------------------------------------------------------------------
-- Owner confirmation for "no response" follow-ups (Data API)
-- ---------------------------------------------------------------------------
create function public.confirm_no_response_follow_up(p_activity_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  a public.activities;
begin
  select * into a from public.activities where id = p_activity_id;
  if not found or a.outcome not in ('no_response', 'no_answer') then
    return 0;
  end if;
  return crm_engine.apply_rule('no_response_follow_up', a.contact_id, a.opportunity_id, crm_engine.user_today(),
    'act:' || a.id || ':rule:no_response_follow_up');
end;
$$;

comment on function public.confirm_no_response_follow_up is
  'Creates the "no response" follow-up after the owner confirms (Phase 6). SECURITY INVOKER.';
revoke all on function public.confirm_no_response_follow_up(uuid) from public, anon;
grant execute on function public.confirm_no_response_follow_up(uuid) to authenticated;
