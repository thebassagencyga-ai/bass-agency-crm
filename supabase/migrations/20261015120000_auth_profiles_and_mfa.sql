-- Phase 2: authentication foundation.
-- 1. Create a profile (and, through the existing trigger, the default automation rules)
--    whenever Supabase Auth adds a user.
-- 2. Make two-step login mandatory at the database level (ADR-016): a session that has only
--    passed the password step (aal1) can read and write nothing. Restrictive policies are
--    ANDed with the existing owner policies, so both must pass.

-- SECURITY DEFINER: runs as the migration owner so it can insert into public.profiles,
-- which API roles cannot. search_path is empty; every reference is schema-qualified.
create function crm_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        split_part(coalesce(new.email, ''), '@', 1)
      ),
      100
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function crm_private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function crm_private.handle_new_user();

-- Backfill: users created in the dashboard before this migration get a profile too.
insert into public.profiles (id, display_name)
select u.id, left(split_part(coalesce(u.email, ''), '@', 1), 100)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Mandatory two-step login: every table requires an aal2 session.
create policy profiles_require_mfa on public.profiles
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy product_lines_require_mfa on public.product_lines
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy pipeline_stages_require_mfa on public.pipeline_stages
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy contacts_require_mfa on public.contacts
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy opportunities_require_mfa on public.opportunities
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy automation_rules_require_mfa on public.automation_rules
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy tasks_require_mfa on public.tasks
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy activities_require_mfa on public.activities
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy audit_log_require_mfa on public.audit_log
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');
