-- Phase 3: contact search, duplicate detection and lead-source suggestions.
--
-- All three are SECURITY INVOKER (the default) with an empty search_path, so they run as the
-- calling user: row level security, including the two-step (aal2) requirement, filters every
-- row. They take the search text as a parameter (never concatenated into SQL) and escape LIKE
-- wildcards so "%" or "_" typed by the user match literally.

create function public.search_contacts(
  p_query text default '',
  p_type public.contact_type default null,
  p_status public.relationship_status default null,
  p_lead_source text default null,
  p_archived text default 'active',
  p_sort text default 'name',
  p_limit integer default 25,
  p_offset integer default 0
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
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
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
  'Contact list search (Phase 3). SECURITY INVOKER: RLS limits results to the caller''s own contacts.';

-- Possible duplicates for the "you may already have this contact" warning: same email
-- (case-insensitive) or the same last 10 phone digits, including archived contacts.
create function public.find_possible_duplicates(
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

comment on function public.find_possible_duplicates is
  'Duplicate warning (Phase 3): same email or same 10-digit phone. SECURITY INVOKER.';

-- Distinct lead sources already used (case-insensitive), for the lead-source suggestions.
create function public.contact_lead_sources()
returns setof text
language sql
stable
set search_path = ''
as $$
  select min(c.lead_source)
  from public.contacts c
  where c.lead_source is not null and btrim(c.lead_source) <> ''
  group by lower(btrim(c.lead_source))
  order by lower(btrim(min(c.lead_source)));
$$;

revoke all on function public.search_contacts(text, public.contact_type, public.relationship_status, text, text, text, integer, integer) from public, anon;
revoke all on function public.find_possible_duplicates(text, text, uuid) from public, anon;
revoke all on function public.contact_lead_sources() from public, anon;
grant execute on function public.search_contacts(text, public.contact_type, public.relationship_status, text, text, text, integer, integer) to authenticated;
grant execute on function public.find_possible_duplicates(text, text, uuid) to authenticated;
grant execute on function public.contact_lead_sources() to authenticated;
