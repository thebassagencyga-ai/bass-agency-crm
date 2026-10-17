-- Phase 18: calendar feed for tasks (ADR-034).
--
-- The owner subscribes their phone's calendar (iPhone Calendar, Google Calendar) to a private
-- link, /calendar/<token>.ics. Calendar apps fetch it without signing in, so — like the public
-- intake form (ADR-028) — the feed is read through ONE narrow SECURITY DEFINER function that
-- anonymous callers may run: public.calendar_feed. It takes the link token, and returns only
-- the open tasks of that link's owner (title, due date, priority, the contact's name). Nothing
-- else, and nothing for a disabled or unknown link.
--
-- Only a SHA-256 hash of the token is stored: the link is shown once when created and cannot be
-- read back from the database (or a backup). Replacing the link disables the old one.

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  enabled boolean not null default true,
  disabled_at timestamptz,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_feeds_token_hash_key unique (token_hash),
  constraint calendar_feeds_id_owner_key unique (id, owner_id),
  constraint calendar_feeds_disabled_check check (enabled = (disabled_at is null))
);
comment on table public.calendar_feeds is
  'Calendar subscription links (/calendar/<token>.ics), stored as SHA-256 hashes. One enabled per agent; replaced links stay, disabled.';

create unique index calendar_feeds_one_enabled_idx on public.calendar_feeds (owner_id) where enabled;

create trigger calendar_feeds_touch before update on public.calendar_feeds
  for each row execute function crm_private.touch_row();
create trigger calendar_feeds_keep_owner before update on public.calendar_feeds
  for each row execute function crm_private.keep_owner();
-- Audited when created, turned off or replaced — not on every fetch by the calendar app.
create trigger calendar_feeds_audit after insert or update of enabled, disabled_at or delete on public.calendar_feeds
  for each row execute function crm_private.write_audit_log();

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
grant select, insert on public.calendar_feeds to authenticated;
grant update (enabled, disabled_at) on public.calendar_feeds to authenticated;

create policy calendar_feeds_select_own on public.calendar_feeds
  for select to authenticated using (owner_id = (select auth.uid()));
create policy calendar_feeds_insert_own on public.calendar_feeds
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy calendar_feeds_update_own on public.calendar_feeds
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy calendar_feeds_require_mfa on public.calendar_feeds
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- Create a new link (disabling the current one). Returns the token once; only its hash is kept.
-- 64 hex characters from two random UUIDs (244 random bits).
create function public.rotate_calendar_link()
returns text
language plpgsql
set search_path = ''
as $$
declare
  t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  update public.calendar_feeds f set enabled = false, disabled_at = now()
  where f.owner_id = (select auth.uid()) and f.enabled;
  insert into public.calendar_feeds (token_hash) values (sha256(convert_to(t, 'UTF8')));
  return t;
end;
$$;
comment on function public.rotate_calendar_link() is
  'Phase 18: new calendar link for the signed-in user (old one disabled). SECURITY INVOKER.';

-- The feed itself: the open tasks of an enabled link's owner, due from 90 days ago to 400 days
-- ahead, at most 1,000. Unknown or disabled link → P0002 (the app answers 404).
create function public.calendar_feed(p_token text)
returns table (
  task_id uuid, title text, due_date date, priority public.task_priority, category public.task_category,
  contact_name text, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  feed public.calendar_feeds;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'feed_unavailable' using errcode = 'P0002';
  end if;
  select * into feed from public.calendar_feeds f
  where f.token_hash = sha256(convert_to(p_token, 'UTF8')) and f.enabled;
  if not found then
    raise exception 'feed_unavailable' using errcode = 'P0002';
  end if;
  -- "Last used" for Settings, at most once an hour (calendar apps poll often).
  update public.calendar_feeds set last_fetched_at = now()
  where id = feed.id and (last_fetched_at is null or last_fetched_at < now() - interval '1 hour');

  return query
    select t.id, t.title, t.due_date, t.priority, t.category,
      case when c.contact_type = 'business' then c.business_name
           else nullif(concat_ws(' ', c.first_name, c.last_name), '') end,
      t.updated_at
    from public.tasks t
    join public.contacts c on c.id = t.contact_id
    where t.owner_id = feed.owner_id
      and t.status = 'open'
      and t.due_date between current_date - 90 and current_date + 400
    order by t.due_date, t.id
    limit 1000;
end;
$$;
comment on function public.calendar_feed(text) is
  'Phase 18 calendar feed: SECURITY DEFINER, anonymous callers only; returns the open tasks of the link''s owner and nothing else.';

revoke all on function public.rotate_calendar_link() from public, anon;
grant execute on function public.rotate_calendar_link() to authenticated;
revoke all on function public.calendar_feed(text) from public, authenticated;
grant execute on function public.calendar_feed(text) to anon;
