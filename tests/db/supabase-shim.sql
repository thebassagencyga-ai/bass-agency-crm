-- TEST-ONLY stand-in for the parts of Supabase that the migrations depend on, so schema and
-- RLS tests can run on plain PostgreSQL (ADR-003). Never apply this to a Supabase project:
-- Supabase already provides these objects.
--
-- Mirrors Supabase: API roles anon/authenticated (no login, no RLS bypass), service_role
-- (bypasses RLS), auth.users, and auth.uid() reading the JWT claims set per request.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema auth;

create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
