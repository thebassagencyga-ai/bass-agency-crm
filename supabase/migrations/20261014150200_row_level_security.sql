-- Row level security and privileges (SECURITY.md §4).
--
-- The hosted project has "Automatically expose new tables" OFF and "Automatic RLS" ON
-- (ADR-002). This migration does not rely on either: it enables RLS and grants privileges
-- explicitly, so the result is the same on any Supabase or plain PostgreSQL database.
--
-- Rules
-- * anon: no access to any table.
-- * authenticated: only rows where owner_id = auth.uid(); reference tables are read-only.
-- * No DELETE privilege on business tables: records are archived/closed, never deleted
--   from the app, so history is preserved.
-- * audit_log: read-only for the owner; written only by trigger.

-- 1. Enable RLS everywhere.
alter table public.profiles enable row level security;
alter table public.product_lines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.contacts enable row level security;
alter table public.opportunities enable row level security;
alter table public.automation_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.audit_log enable row level security;

-- 2. Start from zero privileges for API roles, then grant the minimum.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema crm_private from public, anon, authenticated;
revoke all on schema crm_private from anon, authenticated;

grant select on public.product_lines, public.pipeline_stages to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, time_zone) on public.profiles to authenticated;
grant select, insert, update on
  public.contacts, public.opportunities, public.automation_rules, public.tasks, public.activities
  to authenticated;
grant select on public.audit_log to authenticated;

-- 3. Policies. (select auth.uid()) is evaluated once per statement rather than per row.

-- Reference data: any signed-in user may read.
create policy product_lines_read on public.product_lines
  for select to authenticated using (true);
create policy pipeline_stages_read on public.pipeline_stages
  for select to authenticated using (true);

-- Profiles: a user sees and edits only their own profile. Profiles are created by the
-- sign-up path (Phase 2), not by API users.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Owner-scoped business tables.
create policy contacts_select_own on public.contacts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy contacts_insert_own on public.contacts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy contacts_update_own on public.contacts
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy opportunities_select_own on public.opportunities
  for select to authenticated using (owner_id = (select auth.uid()));
create policy opportunities_insert_own on public.opportunities
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy opportunities_update_own on public.opportunities
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy automation_rules_select_own on public.automation_rules
  for select to authenticated using (owner_id = (select auth.uid()));
create policy automation_rules_insert_own on public.automation_rules
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy automation_rules_update_own on public.automation_rules
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy tasks_select_own on public.tasks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy tasks_insert_own on public.tasks
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy tasks_update_own on public.tasks
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy activities_select_own on public.activities
  for select to authenticated using (owner_id = (select auth.uid()));
create policy activities_insert_own on public.activities
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy activities_update_own on public.activities
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy audit_log_select_own on public.audit_log
  for select to authenticated using (owner_id = (select auth.uid()));
