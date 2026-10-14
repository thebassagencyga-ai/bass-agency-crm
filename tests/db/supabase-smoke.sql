-- Smoke test run in CI against Supabase's real Postgres image (`supabase db start`), where
-- auth.users, auth.uid() and the API roles are Supabase's own rather than the test shim.
-- Everything runs in one transaction and is rolled back. Fictional data only.
-- Any failed check raises an exception, which fails the CI job.

begin;

-- Profiles and default rules are created by the on_auth_user_created trigger.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000a1', 'smoke-a@example.com'),
       ('00000000-0000-4000-8000-0000000000b2', 'smoke-b@example.com');

do $$
begin
  if exists (
    select 1 from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity
  ) then
    raise exception 'A public table has RLS disabled';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
  ) then
    raise exception 'anon holds privileges on a public table';
  end if;
  if (select count(*) from public.automation_rules where owner_id = '00000000-0000-4000-8000-0000000000a1') <> 12 then
    raise exception 'Default automation rules were not created';
  end if;
end;
$$;

-- As user A (real auth.uid()/auth.jwt() read request.jwt.claims), after two-step login.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into public.contacts (contact_type, first_name) values ('individual', 'Smoke');
do $$
begin
  if (select count(*) from public.contacts) <> 1 then
    raise exception 'User A cannot see their own contact';
  end if;
end;
$$;
reset role;

-- As user A with a password-only session (aal1): must see nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.contacts) <> 0 then
    raise exception 'A password-only (aal1) session can read contacts';
  end if;
end;
$$;
reset role;

-- As user B: must not see A's contact.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.contacts) <> 0 then
    raise exception 'User B can see User A''s contact';
  end if;
end;
$$;
reset role;

-- As anon: no access at all.
set local role anon;
do $$
begin
  perform 1 from public.contacts;
  raise exception 'anon was able to query contacts';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;

rollback;
\echo 'Supabase smoke test passed'
