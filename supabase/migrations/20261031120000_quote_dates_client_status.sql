-- Phase 23 (workflow audit Step 1, ADR-039): quote dates and client status.
--
-- 1. Quote stages. Moving an opportunity into a stage where the quote has been delivered
--    (auto/home "Quoted", commercial "Proposal Presented") records the quote date when none is
--    set yet: today in the agent's time zone. The app lets the agent change it (detail page);
--    this trigger is the guarantee for every other path (board moves, new opportunities). An
--    existing date is never overwritten here. Setting the date fires the existing
--    quote_sent_follow_up rule, whose task is keyed per opportunity cycle, so a later date
--    correction re-dates the same task instead of adding one.
-- 2. Client status. When an opportunity is bound (outcome becomes won), a prospect or former
--    client becomes a client. Nothing else changes status here: losing or reopening an
--    opportunity never downgrades a contact (former client still comes only from a lost
--    renewal with no other active policy, record_renewal_outcome).
-- 3. One-time correction for contacts that already hold an active bound policy.

-- ---------------------------------------------------------------------------
-- 1. Quote stages
-- ---------------------------------------------------------------------------
alter table public.pipeline_stages
  add column is_quote_stage boolean not null default false;
comment on column public.pipeline_stages.is_quote_stage is
  'Phase 23: entering this stage means the quote was delivered; the quote date is recorded if missing.';

update public.pipeline_stages set is_quote_stage = true
where (product_line, code) in (('auto', 'quoted'), ('home', 'quoted'), ('commercial', 'proposal_presented'));

create function crm_private.default_quote_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quote_sent_on is null
     and new.outcome in ('open', 'nurture')
     and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id)
     and exists (select 1 from public.pipeline_stages s where s.id = new.stage_id and s.is_quote_stage) then
    new.quote_sent_on := crm_engine.user_today();
  end if;
  return new;
end;
$$;
revoke all on function crm_private.default_quote_date() from public, anon, authenticated;

create trigger opportunities_default_quote_date
  before insert or update of stage_id on public.opportunities
  for each row execute function crm_private.default_quote_date();

-- ---------------------------------------------------------------------------
-- 2. Bound → client
-- ---------------------------------------------------------------------------
create function crm_private.promote_contact_to_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.outcome = 'won' and (tg_op = 'INSERT' or old.outcome is distinct from 'won') then
    update public.contacts c
    set relationship_status = 'client'
    where c.id = new.contact_id
      and c.owner_id = new.owner_id
      and c.relationship_status in ('prospect', 'former_client');
  end if;
  return null;
end;
$$;
revoke all on function crm_private.promote_contact_to_client() from public, anon, authenticated;

create trigger opportunities_promote_contact
  after insert or update of outcome on public.opportunities
  for each row execute function crm_private.promote_contact_to_client();

-- ---------------------------------------------------------------------------
-- 3. One-time correction (kept as a function so it is tested; not callable by the app).
--    Scope: contacts that are not merged and hold at least one ACTIVE bound policy (won, not
--    ended) but are marked prospect or former client. Contacts whose only policies have
--    ended are left alone. Every change is written to the audit log by the contacts trigger.
-- ---------------------------------------------------------------------------
create function crm_private.correct_client_statuses()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.contacts c
  set relationship_status = 'client'
  where c.relationship_status in ('prospect', 'former_client')
    and c.merged_into_contact_id is null
    and exists (
      select 1 from public.opportunities o
      where o.contact_id = c.id and o.owner_id = c.owner_id
        and o.outcome = 'won' and o.policy_ended_on is null
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function crm_private.correct_client_statuses() from public, anon, authenticated;

do $$
declare
  n integer := crm_private.correct_client_statuses();
begin
  raise notice 'Phase 23: % contact(s) with an active bound policy marked as client.', n;
end;
$$;
