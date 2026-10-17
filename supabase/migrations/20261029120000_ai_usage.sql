-- Phase 19: AI helpers — usage ledger for the monthly spending cap (ADR-035).
--
-- The AI helpers (draft a message, notes → activity, daily briefing, import clean-up) run on
-- the server with the Anthropic API. They never change CRM records: every result is shown to
-- the user, who decides what to save or send. This table records each call's tokens and cost so
-- the app can refuse new calls once the month's cap ($10) would be exceeded. No prompt or
-- response text is stored.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  job text not null check (job in ('draft_message', 'notes_to_activity', 'daily_briefing', 'import_cleanup')),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ai_usage is
  'One row per AI helper call (Phase 19): tokens and cost only, never prompt or response text. Feeds the monthly cap.';

create index ai_usage_owner_created_idx on public.ai_usage (owner_id, created_at);

create trigger ai_usage_touch before update on public.ai_usage
  for each row execute function crm_private.touch_row();
create trigger ai_usage_keep_owner before update on public.ai_usage
  for each row execute function crm_private.keep_owner();

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
-- Insert and read only: a recorded cost cannot be edited or removed by the app.
grant select, insert on public.ai_usage to authenticated;

create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using (owner_id = (select auth.uid()));
create policy ai_usage_insert_own on public.ai_usage
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy ai_usage_require_mfa on public.ai_usage
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
