-- Phase 17: tags on contacts and merging duplicate contacts (ADR-033).
--
-- Tags are a short list of labels on the contact itself (contacts.tags), owner-scoped by the
-- contacts table's existing RLS; no new table. Merging moves everything from one contact to
-- another in one transaction, fills the kept contact's blanks from the duplicate and archives
-- the duplicate with a "merged into" link. Nothing is deleted. All new functions are SECURITY
-- INVOKER with an empty search_path: they run as the signed-in user, so RLS (including aal2)
-- applies to every row they read or change.

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
-- At most 20 tags, each 1–40 characters with no surrounding spaces or control characters, no
-- tag twice on one contact (ignoring case). A trigger rather than a CHECK constraint: the check
-- needs a subquery, and private functions are not callable by app users (triggers need no grant).
create function crm_private.check_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(cardinality(new.tags), 0) > 20
     or array_position(new.tags, null) is not null
     or exists (select 1 from unnest(new.tags) t
                where char_length(t) not between 1 and 40 or t <> btrim(t) or t ~ '[[:cntrl:]]')
     or (select count(distinct lower(t)) from unnest(new.tags) t) <> coalesce(cardinality(new.tags), 0) then
    raise exception 'Tags: at most 20, each 1 to 40 characters, no repeats.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function crm_private.check_tags() from public, anon, authenticated;

alter table public.contacts add column tags text[] not null default '{}';
create trigger contacts_check_tags before insert or update of tags on public.contacts
  for each row execute function crm_private.check_tags();
create index contacts_tags_idx on public.contacts using gin (tags);

-- Rename a tag on every contact (a new name already on a contact is not added twice), or remove
-- it everywhere when p_to is empty. Returns the number of contacts changed.
create function public.rename_tag(p_from text, p_to text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  old_name text := lower(btrim(coalesce(p_from, '')));
  new_name text := nullif(btrim(coalesce(p_to, '')), '');
  changed integer;
begin
  if old_name = '' then
    raise exception 'Choose a tag.' using errcode = '22023';
  end if;
  -- Each matching tag is replaced in place (or dropped); if that makes a repeat, the first one
  -- (and its spelling) stays.
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

-- ---------------------------------------------------------------------------
-- Merged contacts
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column merged_into_contact_id uuid,
  add constraint contacts_merged_into_fk foreign key (merged_into_contact_id, owner_id)
    references public.contacts (id, owner_id) on delete restrict,
  add constraint contacts_not_merged_into_self_check check (merged_into_contact_id <> id),
  -- A merged contact stays archived.
  add constraint contacts_merged_archived_check check (merged_into_contact_id is null or archived_at is not null);
create index contacts_merged_into_idx on public.contacts (merged_into_contact_id) where merged_into_contact_id is not null;

-- Tags in use with how many (unmerged) contacts carry each; one spelling per tag ignoring case
-- (the one used first), for the filter, the suggestions and Settings.
create function public.contact_tags()
returns table (tag text, contact_count integer)
language sql
stable
set search_path = ''
as $$
  select (array_agg(t.tag order by c.created_at, c.id))[1], count(distinct c.id)::integer
  from public.contacts c, unnest(c.tags) as t(tag)
  where c.merged_into_contact_id is null
  group by lower(t.tag)
  order by lower(t.tag) collate "C";
$$;

-- Once merged, always merged (the link is the record of where everything went).
create function crm_private.keep_merge_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.merged_into_contact_id is not null and new.merged_into_contact_id is distinct from old.merged_into_contact_id then
    raise exception 'A merged contact cannot be un-merged.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function crm_private.keep_merge_link() from public, anon, authenticated;
create trigger contacts_keep_merge_link before update of merged_into_contact_id on public.contacts
  for each row execute function crm_private.keep_merge_link();

-- Moving an opportunity to another contact carries its tasks and activities along (their
-- (opportunity, contact) pair must keep matching). Same constraints, plus ON UPDATE CASCADE.
alter table public.tasks drop constraint tasks_opportunity_fk,
  add constraint tasks_opportunity_fk foreign key (opportunity_id, contact_id)
    references public.opportunities (id, contact_id) on update cascade on delete restrict;
alter table public.activities drop constraint activities_opportunity_fk,
  add constraint activities_opportunity_fk foreign key (opportunity_id, contact_id)
    references public.opportunities (id, contact_id) on update cascade on delete restrict;

-- Merge p_merge into p_keep. The kept contact's own values win; its blanks are filled from the
-- duplicate; notes are combined; tags are added together; the stronger relationship status
-- wins (client > former client > prospect). Everything linked to the duplicate moves to the kept
-- contact. The duplicate is archived and linked to the kept contact. Returns what moved.
create function public.merge_contacts(p_keep uuid, p_merge uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  k public.contacts;
  m public.contacts;
  n_opps integer;
  n_tasks integer;
  n_activities integer;
  n_household integer;
  n_vehicles integer;
  n_requests integer;
  n_referrals integer;
begin
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different contacts.' using errcode = '22023';
  end if;
  -- Lock both rows (in id order, so two merges cannot deadlock). RLS hides other agents' rows.
  perform 1 from public.contacts where id in (p_keep, p_merge) order by id for update;
  select * into k from public.contacts where id = p_keep;
  select * into m from public.contacts where id = p_merge;
  if k.id is null or m.id is null then
    raise exception 'Contact not found.' using errcode = 'P0002';
  end if;
  if k.archived_at is not null then
    raise exception 'keep_archived' using errcode = '22023';
  end if;
  if m.merged_into_contact_id is not null then
    raise exception 'already_merged' using errcode = '22023';
  end if;

  select count(*) into n_tasks from public.tasks where contact_id = m.id;
  select count(*) into n_activities from public.activities where contact_id = m.id;

  -- 1. The kept contact: fill blanks, combine notes and tags.
  update public.contacts c set
    first_name = coalesce(k.first_name, m.first_name),
    last_name = coalesce(k.last_name, m.last_name),
    business_name = coalesce(k.business_name, m.business_name),
    email = coalesce(k.email, m.email),
    phone = coalesce(k.phone, m.phone),
    alt_phone = coalesce(
      k.alt_phone,
      case when k.phone is not null and m.phone is not null
             and right(regexp_replace(m.phone, '\D', '', 'g'), 10) <> right(regexp_replace(k.phone, '\D', '', 'g'), 10)
           then m.phone end,
      m.alt_phone),
    address_line1 = case when num_nonnulls(k.address_line1, k.address_line2, k.city, k.state, k.postal_code) = 0 then m.address_line1 else k.address_line1 end,
    address_line2 = case when num_nonnulls(k.address_line1, k.address_line2, k.city, k.state, k.postal_code) = 0 then m.address_line2 else k.address_line2 end,
    city = case when num_nonnulls(k.address_line1, k.address_line2, k.city, k.state, k.postal_code) = 0 then m.city else k.city end,
    state = case when num_nonnulls(k.address_line1, k.address_line2, k.city, k.state, k.postal_code) = 0 then m.state else k.state end,
    postal_code = case when num_nonnulls(k.address_line1, k.address_line2, k.city, k.state, k.postal_code) = 0 then m.postal_code else k.postal_code end,
    preferred_contact_method = coalesce(k.preferred_contact_method, m.preferred_contact_method),
    lead_source = coalesce(k.lead_source, m.lead_source),
    relationship_status = case
      when 'client' in (k.relationship_status, m.relationship_status) then 'client'::public.relationship_status
      when 'former_client' in (k.relationship_status, m.relationship_status) then 'former_client'::public.relationship_status
      else 'prospect'::public.relationship_status end,
    referred_by_contact_id = case
      when k.referred_by_contact_id is not null and k.referred_by_contact_id <> m.id then k.referred_by_contact_id
      when m.referred_by_contact_id is not null and m.referred_by_contact_id <> k.id then m.referred_by_contact_id
      end,
    google_review_left_on = least(k.google_review_left_on, m.google_review_left_on),
    notes = case
      when m.notes is null or btrim(m.notes) = '' then k.notes
      when k.notes is null or btrim(k.notes) = '' then m.notes
      else left(k.notes || E'\n\n— Merged from a duplicate contact —\n' || m.notes, 5000) end,
    -- The kept contact's tags first, then the duplicate's new ones; at most 20.
    tags = (
      select coalesce(array_agg(x.tag order by x.n), '{}') from (
        select distinct on (lower(u.tag)) u.tag, u.n
        from unnest(k.tags || m.tags) with ordinality as u(tag, n)
        order by lower(u.tag), u.n
      ) x
    )[1:20]
  where c.id = k.id;

  -- 2. Everything linked to the duplicate. Opportunities first: their tasks and activities
  --    follow through ON UPDATE CASCADE; then the ones not tied to an opportunity.
  update public.opportunities set contact_id = k.id where contact_id = m.id;
  get diagnostics n_opps = row_count;
  update public.tasks set contact_id = k.id where contact_id = m.id;
  update public.activities set contact_id = k.id where contact_id = m.id;
  update public.household_members set contact_id = k.id where contact_id = m.id;
  get diagnostics n_household = row_count;
  update public.vehicles set contact_id = k.id where contact_id = m.id;
  get diagnostics n_vehicles = row_count;
  update public.intake_submissions set contact_id = k.id where contact_id = m.id;
  get diagnostics n_requests = row_count;
  -- A cross-sell suggestion dismissed on either contact stays dismissed (one per rule).
  update public.cross_sell_dismissals d set contact_id = k.id
  where d.contact_id = m.id
    and not exists (select 1 from public.cross_sell_dismissals x where x.contact_id = k.id and x.rule_id = d.rule_id);
  update public.contacts set referred_by_contact_id = k.id
  where referred_by_contact_id = m.id and id <> k.id;
  get diagnostics n_referrals = row_count;

  -- 3. The duplicate: archived, linked, otherwise kept as it was.
  update public.contacts set archived_at = coalesce(archived_at, now()), merged_into_contact_id = k.id
  where id = m.id;

  return jsonb_build_object(
    'kept_id', k.id, 'merged_id', m.id, 'opportunities', n_opps, 'tasks', n_tasks, 'activities', n_activities,
    'household', n_household, 'vehicles', n_vehicles, 'requests', n_requests, 'referrals', n_referrals);
end;
$$;
comment on function public.merge_contacts(uuid, uuid) is
  'Merge duplicate contacts (Phase 17): one transaction, runs as the signed-in user (RLS applies); nothing deleted.';

-- ---------------------------------------------------------------------------
-- Contact search: tag filter; merged contacts are no longer "possible duplicates"
-- ---------------------------------------------------------------------------
drop function public.search_contacts(text, public.contact_type, public.relationship_status, text, text, text, integer, integer);
create function public.search_contacts(
  p_query text default '',
  p_type public.contact_type default null,
  p_status public.relationship_status default null,
  p_lead_source text default null,
  p_archived text default 'active',
  p_sort text default 'name',
  p_limit integer default 25,
  p_offset integer default 0,
  p_tag text default null
)
returns setof public.contacts
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits,
      nullif(lower(btrim(coalesce(p_tag, ''))), '') as tag
  )
  select c.*
  from public.contacts c, params p
  where
    (
      p.q is null
      or concat_ws(' ', c.first_name, c.last_name) ilike p.pattern escape '\'
      or concat_ws(' ', c.last_name, c.first_name) ilike p.pattern escape '\'
      or c.business_name ilike p.pattern escape '\'
      or c.email ilike p.pattern escape '\'
      or (
        length(p.digits) >= 3
        and (
          regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || p.digits || '%'
          or regexp_replace(coalesce(c.alt_phone, ''), '\D', '', 'g') like '%' || p.digits || '%'
        )
      )
    )
    and (p_type is null or c.contact_type = p_type)
    and (p_status is null or c.relationship_status = p_status)
    and (p_lead_source is null or lower(c.lead_source) = lower(btrim(p_lead_source)))
    and (p.tag is null or exists (select 1 from unnest(c.tags) t where lower(t) = p.tag))
    and case coalesce(p_archived, 'active')
          when 'all' then true
          when 'archived' then c.archived_at is not null
          else c.archived_at is null
        end
  order by
    case when coalesce(p_sort, 'name') not in ('recent', 'updated') then
      lower(coalesce(case when c.contact_type = 'business' then c.business_name end, c.last_name, c.first_name, c.business_name, ''))
    end,
    case when coalesce(p_sort, 'name') not in ('recent', 'updated') then lower(coalesce(c.first_name, '')) end,
    case when p_sort = 'recent' then c.created_at end desc,
    case when p_sort = 'updated' then c.updated_at end desc,
    c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
comment on function public.search_contacts is
  'Contact list search (Phase 3; tag filter Phase 17). SECURITY INVOKER: RLS limits results to the caller''s own contacts.';

create or replace function public.find_possible_duplicates(
  p_email text,
  p_phone text,
  p_exclude_id uuid default null
)
returns setof public.contacts
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
      right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as phone10
  )
  select c.*
  from public.contacts c, params p
  where (p_exclude_id is null or c.id <> p_exclude_id)
    and c.merged_into_contact_id is null
    and (
      (p.email is not null and lower(c.email) = p.email)
      or (
        length(p.phone10) = 10
        and (
          right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = p.phone10
          or right(regexp_replace(coalesce(c.alt_phone, ''), '\D', '', 'g'), 10) = p.phone10
        )
      )
    )
  order by c.archived_at nulls first, c.created_at
  limit 5;
$$;

revoke all on function public.search_contacts(text, public.contact_type, public.relationship_status, text, text, text, integer, integer, text) from public, anon;
revoke all on function public.contact_tags() from public, anon;
revoke all on function public.rename_tag(text, text) from public, anon;
revoke all on function public.merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.search_contacts(text, public.contact_type, public.relationship_status, text, text, text, integer, integer, text) to authenticated;
grant execute on function public.contact_tags() to authenticated;
grant execute on function public.rename_tag(text, text) to authenticated;
grant execute on function public.merge_contacts(uuid, uuid) to authenticated;
