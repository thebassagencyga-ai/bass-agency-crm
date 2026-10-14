-- Core schema for The Bass Agency CRM (Phase 1).
-- See docs/data-model.md for the entity diagram and data dictionary.
--
-- Design notes
-- * Every business row carries owner_id (= auth.uid() of the agent who owns it).
-- * Composite foreign keys that include owner_id make it impossible, at the database level,
--   to link a record to a contact/opportunity owned by a different agent.
-- * Pipeline stage and outcome are separate columns (ADR-006). The stage's kind is copied
--   onto the opportunity through a composite FK so a CHECK constraint can keep them consistent.
-- * Calendar values are `date`; instants are `timestamptz` (ADR-007).
-- * Nothing cascades on delete: history is preserved (contacts are archived, not deleted).

-- Private schema for helper functions. Not exposed through the Data API.
create schema if not exists crm_private;
revoke all on schema crm_private from public;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.contact_type as enum ('individual', 'business');
create type public.relationship_status as enum ('prospect', 'client', 'former_client');
create type public.contact_method as enum ('phone', 'text', 'email', 'in_person', 'no_preference');
create type public.stage_kind as enum ('active', 'won', 'lost');
create type public.opportunity_outcome as enum ('open', 'won', 'lost', 'nurture');
create type public.loss_reason as enum (
  'price', 'coverage', 'chose_competitor', 'stayed_with_current', 'no_response',
  'not_eligible', 'timing', 'other'
);
create type public.task_status as enum ('open', 'completed', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high');
create type public.task_origin as enum ('manual', 'automation');
create type public.activity_type as enum (
  'call', 'meeting', 'note', 'email', 'text_message', 'follow_up', 'quote',
  'review_request', 'referral_request', 'other'
);
create type public.activity_outcome as enum (
  'connected', 'left_message', 'no_answer', 'no_response', 'requested_follow_up',
  'quote_requested', 'quote_sent', 'not_interested',
  'review_left', 'referral_received', 'declined', 'other'
);
-- What a task is for. Lets automation close only prospecting tasks on win/loss while
-- leaving onboarding, renewal, review and referral tasks alone.
create type public.task_category as enum (
  'prospecting', 'onboarding', 'renewal', 'review_request', 'referral_request', 'other'
);
create type public.automation_trigger as enum (
  'opportunity_created', 'initial_contact_no_quote', 'quote_sent', 'follow_up_requested',
  'no_response', 'opportunity_won', 'opportunity_lost', 'renewal_date_known',
  'opportunity_reopened'
);
create type public.automation_action as enum ('create_task', 'close_prospecting_tasks', 'create_checklist');
create type public.automation_anchor as enum ('event_date', 'requested_date', 'renewal_date');
create type public.day_count as enum ('calendar', 'business');

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

-- Maintains updated_at and keeps id/created_at immutable after insert.
create function crm_private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create function crm_private.keep_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per authorized user; ready for future agents)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null default ''
    check (char_length(display_name) <= 100),
  time_zone text not null default 'America/New_York'
    check (time_zone in (
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
      'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'
    )),
  -- Link inserted into review-request messages (ADR-013). https only.
  google_review_url text
    check (char_length(google_review_url) <= 500 and google_review_url ~ '^https://[^\s]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per authorized CRM user. id = auth.users.id.';

create trigger profiles_touch before update on public.profiles
  for each row execute function crm_private.touch_row();

-- ---------------------------------------------------------------------------
-- Reference data: product lines and configurable pipeline stages
-- ---------------------------------------------------------------------------
create table public.product_lines (
  code text primary key check (code ~ '^[a-z][a-z_]{1,30}$'),
  name text not null check (char_length(name) between 1 and 50),
  sort_order smallint not null unique
);
comment on table public.product_lines is 'Insurance product lines. Changed only by migrations.';

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  product_line text not null references public.product_lines (code) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  position smallint not null check (position > 0),
  kind public.stage_kind not null,
  is_active boolean not null default true,
  unique (product_line, code),
  unique (product_line, position),
  -- Target of the composite FK on opportunities (stage must match product line and kind).
  unique (id, product_line, kind)
);
comment on table public.pipeline_stages is
  'Configurable stage definitions per product line. kind = active | won | lost. Changed only by migrations.';

-- ---------------------------------------------------------------------------
-- Contacts (individuals and businesses)
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_type public.contact_type not null,
  first_name text check (char_length(first_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  business_name text check (char_length(business_name) <= 200),
  email text check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 32),
  alt_phone text check (char_length(alt_phone) <= 32),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  state text check (state ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  preferred_contact_method public.contact_method,
  lead_source text check (char_length(lead_source) <= 100),
  relationship_status public.relationship_status not null default 'prospect',
  -- The client (or other contact) who referred this person (ADR-013).
  referred_by_contact_id uuid,
  -- Date the contact left a Google review, as recorded by the agent. Review requests stop once set.
  google_review_left_on date,
  notes text check (char_length(notes) <= 5000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Individuals need a first or last name; businesses need a business name.
  constraint contacts_name_check check (
    case contact_type
      when 'individual' then coalesce(btrim(first_name), '') <> '' or coalesce(btrim(last_name), '') <> ''
      when 'business' then coalesce(btrim(business_name), '') <> ''
    end
  ),
  constraint contacts_id_owner_key unique (id, owner_id),
  constraint contacts_referred_by_fk foreign key (referred_by_contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  constraint contacts_not_self_referred_check check (referred_by_contact_id <> id)
);
comment on table public.contacts is
  'Prospects and clients. Archive (archived_at) instead of deleting. No SSNs, payment or health data.';

create index contacts_owner_active_idx on public.contacts (owner_id, archived_at);
create index contacts_owner_last_name_idx on public.contacts (owner_id, lower(last_name), lower(first_name));
create index contacts_owner_business_idx on public.contacts (owner_id, lower(business_name));
create index contacts_owner_email_idx on public.contacts (owner_id, lower(email));
create index contacts_owner_phone_idx on public.contacts (owner_id, phone);
create index contacts_referred_by_idx on public.contacts (referred_by_contact_id)
  where referred_by_contact_id is not null;

create trigger contacts_touch before update on public.contacts
  for each row execute function crm_private.touch_row();
create trigger contacts_keep_owner before update on public.contacts
  for each row execute function crm_private.keep_owner();

-- ---------------------------------------------------------------------------
-- Opportunities (many per contact, across product lines)
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  product_line text not null,
  stage_id uuid not null,
  stage_kind public.stage_kind not null,
  outcome public.opportunity_outcome not null default 'open',
  description text check (char_length(description) <= 500),
  quote_sent_on date,
  estimated_annual_premium numeric(12, 2) check (estimated_annual_premium >= 0),
  next_action text check (char_length(next_action) <= 500),
  effective_date date,
  renewal_date date,
  loss_reason public.loss_reason,
  loss_reason_detail text check (char_length(loss_reason_detail) <= 1000),
  closed_at timestamptz,
  -- Incremented when a closed opportunity is reopened; automation keys include it (ADR-008).
  cycle integer not null default 1 check (cycle >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opportunities_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  constraint opportunities_stage_fk foreign key (stage_id, product_line, stage_kind)
    references public.pipeline_stages (id, product_line, kind) on update restrict on delete restrict,
  constraint opportunities_stage_outcome_check check (
    (stage_kind = 'active' and outcome in ('open', 'nurture'))
    or (stage_kind = 'won' and outcome = 'won')
    or (stage_kind = 'lost' and outcome = 'lost')
  ),
  constraint opportunities_loss_reason_check check ((outcome = 'lost') = (loss_reason is not null)),
  constraint opportunities_closed_at_check check ((outcome in ('won', 'lost')) = (closed_at is not null)),
  constraint opportunities_renewal_after_effective_check check (
    renewal_date is null or effective_date is null or renewal_date > effective_date
  ),
  constraint opportunities_id_owner_key unique (id, owner_id),
  constraint opportunities_id_contact_key unique (id, contact_id)
);
comment on table public.opportunities is
  'Insurance opportunities. stage = position in pipeline; outcome = open/won/lost/nurture. Closed rows are kept.';
comment on column public.opportunities.stage_kind is
  'Copy of pipeline_stages.kind, enforced by composite FK; lets a CHECK keep stage and outcome consistent.';

create index opportunities_contact_idx on public.opportunities (contact_id);
create index opportunities_owner_board_idx on public.opportunities (owner_id, product_line, outcome, stage_id);
create index opportunities_owner_renewal_idx on public.opportunities (owner_id, renewal_date) where renewal_date is not null;

-- Sets closed_at automatically when an opportunity is won or lost and clears it on reopen.
create function crm_private.opportunity_closed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.outcome in ('won', 'lost') then
    if tg_op = 'INSERT' or old.outcome not in ('won', 'lost') then
      new.closed_at := now();
    else
      new.closed_at := coalesce(old.closed_at, now());
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

-- Copies the stage's kind onto the row so callers only supply stage_id. The composite FK
-- then verifies the stage exists, belongs to this product line, and has this kind.
create function crm_private.opportunity_stage_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.stage_kind := (select s.kind from public.pipeline_stages s where s.id = new.stage_id);
  return new;
end;
$$;

-- Trigger names fire alphabetically: stage kind is resolved before closed_at is computed.
create trigger opportunities_a_stage_kind before insert or update of stage_id on public.opportunities
  for each row execute function crm_private.opportunity_stage_kind();
create trigger opportunities_closed_at before insert or update of outcome on public.opportunities
  for each row execute function crm_private.opportunity_closed_at();
create trigger opportunities_touch before update on public.opportunities
  for each row execute function crm_private.touch_row();
create trigger opportunities_keep_owner before update on public.opportunities
  for each row execute function crm_private.keep_owner();

-- ---------------------------------------------------------------------------
-- Automation rules (configuration only in Phase 1; executed in Phase 6)
-- ---------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  rule_key text not null check (rule_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  name text not null check (char_length(name) between 1 and 100),
  -- null = applies to every product line
  product_line text references public.product_lines (code) on delete restrict,
  trigger_event public.automation_trigger not null,
  action public.automation_action not null,
  anchor public.automation_anchor not null default 'event_date',
  offset_days integer not null default 0 check (offset_days between -365 and 365),
  day_count public.day_count not null default 'calendar',
  task_title_template text check (char_length(task_title_template) <= 200),
  task_priority public.task_priority not null default 'normal',
  task_category public.task_category not null default 'other',
  -- Created tasks start on anchor + offset and are due completion_window_days later.
  completion_window_days integer not null default 0 check (completion_window_days between 0 and 365),
  -- Skip if a task from this rule was created for the same contact within this many days.
  cooldown_days integer check (cooldown_days between 1 and 1095),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_owner_key unique (owner_id, rule_key),
  constraint automation_rules_id_owner_key unique (id, owner_id),
  constraint automation_rules_task_title_check check (
    action <> 'create_task' or coalesce(btrim(task_title_template), '') <> ''
  )
);
comment on table public.automation_rules is
  'Per-agent follow-up rules. Defaults are inserted when a profile is created. Phase 6 executes them.';

create trigger automation_rules_touch before update on public.automation_rules
  for each row execute function crm_private.touch_row();
create trigger automation_rules_keep_owner before update on public.automation_rules
  for each row execute function crm_private.keep_owner();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  opportunity_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  due_date date not null,
  priority public.task_priority not null default 'normal',
  category public.task_category not null default 'other',
  -- Optional: the task is not shown as current work before this date.
  start_date date,
  status public.task_status not null default 'open',
  completed_at timestamptz,
  cancelled_at timestamptz,
  origin public.task_origin not null default 'manual',
  automation_rule_id uuid,
  -- Deterministic key for automation-created tasks; prevents duplicates on retries (ADR-008).
  dedupe_key text check (char_length(dedupe_key) <= 200),
  due_date_overridden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  -- The opportunity must belong to the same contact (and therefore the same owner).
  constraint tasks_opportunity_fk foreign key (opportunity_id, contact_id)
    references public.opportunities (id, contact_id) on delete restrict,
  constraint tasks_rule_fk foreign key (automation_rule_id, owner_id)
    references public.automation_rules (id, owner_id) on delete restrict,
  constraint tasks_start_before_due_check check (start_date is null or start_date <= due_date),
  constraint tasks_completed_check check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint tasks_origin_check check (
    (origin = 'manual' and automation_rule_id is null and dedupe_key is null)
    or (origin = 'automation' and automation_rule_id is not null and dedupe_key is not null)
  ),
  constraint tasks_id_owner_key unique (id, owner_id)
);
comment on table public.tasks is 'Follow-up tasks. Completed and cancelled tasks are kept for history.';

create unique index tasks_owner_dedupe_key on public.tasks (owner_id, dedupe_key) where dedupe_key is not null;
create index tasks_owner_queue_idx on public.tasks (owner_id, status, due_date);
create index tasks_contact_idx on public.tasks (contact_id);
create index tasks_opportunity_idx on public.tasks (opportunity_id) where opportunity_id is not null;

-- Keeps completed_at / cancelled_at in step with status so callers only set status.
create function crm_private.task_status_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at := case
      when tg_op = 'UPDATE' and old.status = 'completed' then coalesce(old.completed_at, now())
      else coalesce(new.completed_at, now())
    end;
  else
    new.completed_at := null;
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := case
      when tg_op = 'UPDATE' and old.status = 'cancelled' then coalesce(old.cancelled_at, now())
      else coalesce(new.cancelled_at, now())
    end;
  else
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_status_timestamps before insert or update of status on public.tasks
  for each row execute function crm_private.task_status_timestamps();
create trigger tasks_touch before update on public.tasks
  for each row execute function crm_private.touch_row();
create trigger tasks_keep_owner before update on public.tasks
  for each row execute function crm_private.keep_owner();

-- ---------------------------------------------------------------------------
-- Activities (calls, meetings, notes, follow-up outcomes)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  contact_id uuid not null,
  opportunity_id uuid,
  task_id uuid,
  activity_type public.activity_type not null,
  occurred_at timestamptz not null default now(),
  outcome public.activity_outcome,
  -- Date the prospect asked to be contacted again (drives the follow_up_requested rule).
  requested_follow_up_on date,
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activities_contact_fk foreign key (contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  constraint activities_opportunity_fk foreign key (opportunity_id, contact_id)
    references public.opportunities (id, contact_id) on delete restrict,
  constraint activities_task_fk foreign key (task_id, owner_id)
    references public.tasks (id, owner_id) on delete restrict,
  constraint activities_follow_up_check check (
    requested_follow_up_on is null or outcome = 'requested_follow_up'
  )
);
comment on table public.activities is 'Contact history. Rows are never deleted by the application.';

create index activities_contact_idx on public.activities (contact_id, occurred_at desc);
create index activities_owner_recent_idx on public.activities (owner_id, occurred_at desc);
create index activities_opportunity_idx on public.activities (opportunity_id) where opportunity_id is not null;

create trigger activities_touch before update on public.activities
  for each row execute function crm_private.touch_row();
create trigger activities_keep_owner before update on public.activities
  for each row execute function crm_private.keep_owner();
