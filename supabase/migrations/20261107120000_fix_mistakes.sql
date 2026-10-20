-- Phase 29 (ADR-047): fixing mistakes on deals (owner request 2026-10-20; choices: any deal's
-- line can change; both "existing policy" and "remove"; the win's onboarding/review/referral
-- tasks are closed when a deal becomes an existing policy).
--
-- 1. A deal's line can be corrected. The stage, tasks, activities and dates stay; a 6-month term
--    becomes 12 months unless the new line is auto, and life commission details clear unless it
--    is life. The audit log records the change.
-- 2. A won deal entered as a new sale can be marked as a policy the client already had
--    (false → true only, never back): off the board and out of sales figures.
-- 3. A deal entered by mistake can be removed: removed_at is set, its open tasks are closed, and
--    a restrictive policy hides it from the app everywhere (lists, reports, Focus, Production).
--    Nothing is deleted; the audit log keeps it.

-- ---------------------------------------------------------------------------
-- 1. Line corrections (lifecycle trigger from 20261021120000, the lock replaced by resets)
-- ---------------------------------------------------------------------------
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
    if new.product_line <> 'auto' then
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

-- ---------------------------------------------------------------------------
-- 2. Existing policy: may now be turned on later for a won deal (never off)
-- ---------------------------------------------------------------------------
create or replace function crm_private.existing_policy_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.existing_policy and new.outcome <> 'won' then
      raise exception 'An existing policy is saved as won.' using errcode = 'check_violation';
    end if;
  elsif old.existing_policy then
    new.existing_policy := true;
  elsif new.existing_policy and (new.outcome <> 'won' or new.import_batch_id is not null) then
    new.existing_policy := false;
  end if;
  return new;
end;
$$;

create function public.mark_existing_policy(p_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  o public.opportunities;
  closed integer;
begin
  select * into o from public.opportunities where id = p_id;
  if not found then
    raise exception 'That deal could not be found.' using errcode = 'P0002';
  end if;
  if o.outcome <> 'won' or o.existing_policy or o.import_batch_id is not null then
    raise exception 'Only a won deal entered as a new sale can be marked as an existing policy.' using errcode = 'check_violation';
  end if;
  update public.opportunities set existing_policy = true where id = p_id;
  -- What the win created (owner: close them); renewal reviews stay.
  update public.tasks set status = 'cancelled'
   where opportunity_id = p_id and status = 'open' and category in ('onboarding', 'review_request', 'referral_request');
  get diagnostics closed = row_count;
  return closed;
end;
$$;
comment on function public.mark_existing_policy(uuid) is
  'Phase 29: a won deal becomes a policy the client already had; closes the win''s onboarding, review and referral tasks. SECURITY INVOKER.';
revoke all on function public.mark_existing_policy(uuid) from public, anon;
grant execute on function public.mark_existing_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Removing a deal entered by mistake
-- ---------------------------------------------------------------------------
alter table public.opportunities add column removed_at timestamptz;
comment on column public.opportunities.removed_at is
  'Phase 29: set when the deal was removed as entered by mistake; such deals are hidden from the app (kept in the audit log).';

-- Hidden from every read through the API, and no longer editable. Postgres checks the updated row
-- against the select policies too, so a deal stays visible only within the transaction that
-- removes it (now() is the transaction's start time); every later request hides it.
create policy opportunities_hide_removed on public.opportunities
  as restrictive for select to authenticated using (removed_at is null or removed_at = now());
create policy opportunities_removed_read_only on public.opportunities
  as restrictive for update to authenticated using (removed_at is null) with check (true);

create function public.remove_opportunity(p_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  closed integer;
begin
  if not exists (select 1 from public.opportunities where id = p_id) then
    raise exception 'That deal could not be found.' using errcode = 'P0002';
  end if;
  update public.tasks set status = 'cancelled' where opportunity_id = p_id and status = 'open';
  get diagnostics closed = row_count;
  update public.opportunities set removed_at = now() where id = p_id;
  return closed;
end;
$$;
comment on function public.remove_opportunity(uuid) is
  'Phase 29: hides a deal entered by mistake and closes its open tasks; nothing is deleted. SECURITY INVOKER.';
revoke all on function public.remove_opportunity(uuid) from public, anon;
grant execute on function public.remove_opportunity(uuid) to authenticated;
