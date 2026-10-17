-- Phase 20: tags come from a list the owner keeps (ADR-036, owner decision 2026-10-17: "this
-- should be a ticker with options for consistency"; new tags only in Settings; starter list).
--
-- tag_options is the list. A contact can only gain a tag that is on its owner's list (trigger
-- below); tags already on a contact stay valid. Every tag already in use is added to the list,
-- and each agent starts with a short starter list they can rename or remove.

create table public.tag_options (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name text not null check (
    char_length(name) between 1 and 40 and name = btrim(name) and position(',' in name) = 0 and name !~ '[[:cntrl:]]'
  ),
  -- Removed tags are archived, not deleted (no DELETE privilege, as elsewhere).
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tag_options is
  'Phase 20: the tags an agent can put on contacts (picked from this list). Archived when removed.';

create unique index tag_options_owner_name_idx on public.tag_options (owner_id, lower(name)) where archived_at is null;

create trigger tag_options_touch before update on public.tag_options
  for each row execute function crm_private.touch_row();
create trigger tag_options_keep_owner before update on public.tag_options
  for each row execute function crm_private.keep_owner();
create trigger tag_options_audit after insert or update or delete on public.tag_options
  for each row execute function crm_private.write_audit_log();

alter table public.tag_options enable row level security;
revoke all on public.tag_options from anon, authenticated;
grant select on public.tag_options to authenticated;
grant insert (name) on public.tag_options to authenticated;
grant update (name, archived_at) on public.tag_options to authenticated;

create policy tag_options_select_own on public.tag_options
  for select to authenticated using (owner_id = (select auth.uid()));
create policy tag_options_insert_own on public.tag_options
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy tag_options_update_own on public.tag_options
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy tag_options_require_mfa on public.tag_options
  as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2') with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------------
-- Starter list for every agent (existing and new), plus every tag already in use.
-- ---------------------------------------------------------------------------
create function crm_private.insert_default_tag_options(p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tag_options (owner_id, name)
  select p_owner, n
  from unnest(array['VIP', 'Referral partner', 'Church', 'Small business', 'Farm', 'Family plan', 'Do not text']) as n
  where not exists (
    select 1 from public.tag_options o where o.owner_id = p_owner and lower(o.name) = lower(n) and o.archived_at is null
  );
$$;

create function crm_private.create_default_tag_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform crm_private.insert_default_tag_options(new.id);
  return new;
end;
$$;

revoke all on function crm_private.insert_default_tag_options(uuid) from public, anon, authenticated;
revoke all on function crm_private.create_default_tag_options() from public, anon, authenticated;

create trigger profiles_default_tag_options after insert on public.profiles
  for each row execute function crm_private.create_default_tag_options();

-- Tags already on contacts (one spelling per tag, the first used), then the starter list.
insert into public.tag_options (owner_id, name)
select owner_id, (array_agg(tag order by created_at, id))[1]
from (select c.owner_id, c.created_at, c.id, t.tag from public.contacts c, unnest(c.tags) as t(tag)) used
group by owner_id, lower(tag);
select crm_private.insert_default_tag_options(p.id) from public.profiles p;

-- ---------------------------------------------------------------------------
-- Contacts can only gain tags from their owner's list.
-- ---------------------------------------------------------------------------
create or replace function crm_private.check_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  unknown text;
begin
  if coalesce(cardinality(new.tags), 0) > 20
     or array_position(new.tags, null) is not null
     or exists (select 1 from unnest(new.tags) t
                where char_length(t) not between 1 and 40 or t <> btrim(t) or t ~ '[[:cntrl:]]')
     or (select count(distinct lower(t)) from unnest(new.tags) t) <> coalesce(cardinality(new.tags), 0) then
    raise exception 'Tags: at most 20, each 1 to 40 characters, no repeats.' using errcode = 'check_violation';
  end if;
  -- Only newly added tags are checked, so a contact keeps a tag that was later removed from the list.
  select t into unknown
  from unnest(new.tags) t
  where (tg_op = 'INSERT' or not exists (select 1 from unnest(old.tags) o where lower(o) = lower(t)))
    and not exists (
      select 1 from public.tag_options x
      where x.owner_id = new.owner_id and x.archived_at is null and lower(x.name) = lower(t)
    )
  limit 1;
  if unknown is not null then
    raise exception 'Tag "%" is not in your tag list. Add it in Settings first.', unknown using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The list with how many (unmerged) contacts carry each tag — every option, even unused.
-- ---------------------------------------------------------------------------
create or replace function public.contact_tags()
returns table (tag text, contact_count integer)
language sql
stable
set search_path = ''
as $$
  select o.name,
    (select count(*) from public.contacts c
      where c.merged_into_contact_id is null
        and exists (select 1 from unnest(c.tags) t where lower(t) = lower(o.name)))::integer
  from public.tag_options o
  where o.archived_at is null
  order by lower(o.name) collate "C";
$$;

-- Rename a tag (the list and every contact), fold it into another tag on the list, or remove it
-- (p_to empty: taken off every contact and archived on the list). Returns contacts changed.
create or replace function public.rename_tag(p_from text, p_to text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  old_name text := lower(btrim(coalesce(p_from, '')));
  new_name text := nullif(btrim(coalesce(p_to, '')), '');
  opt public.tag_options;
  target public.tag_options;
  changed integer;
begin
  if old_name = '' then
    raise exception 'Choose a tag.' using errcode = '22023';
  end if;
  select * into opt from public.tag_options o where lower(o.name) = old_name and o.archived_at is null for update;
  if opt.id is null then
    raise exception 'That tag is not in your list.' using errcode = 'P0002';
  end if;

  if new_name is null then
    update public.tag_options set archived_at = now() where id = opt.id;
  else
    select * into target from public.tag_options o
    where lower(o.name) = lower(new_name) and o.archived_at is null and o.id <> opt.id;
    if target.id is not null then
      -- Folding into an existing tag: contacts take its spelling; this one is archived.
      new_name := target.name;
      update public.tag_options set archived_at = now() where id = opt.id;
    else
      update public.tag_options set name = new_name where id = opt.id;
    end if;
  end if;

  -- Each matching tag is replaced in place (or dropped); if that makes a repeat, the first stays.
  update public.contacts c
  set tags = array(
    select x.tag from (
      select distinct on (lower(r.tag)) r.tag, u.n
      from unnest(c.tags) with ordinality as u(tag, n)
      cross join lateral (select case when lower(u.tag) = old_name then new_name else u.tag end as tag) r
      where r.tag is not null
      order by lower(r.tag), u.n
    ) x order by x.n)
  where exists (select 1 from unnest(c.tags) t where lower(t) = old_name);
  get diagnostics changed = row_count;
  return changed;
end;
$$;
