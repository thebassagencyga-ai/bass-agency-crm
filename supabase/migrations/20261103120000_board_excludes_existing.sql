-- Board fix after Phase 25 (owner, 2026-10-19): the board's "won or lost in the last 30 days"
-- left out imported policies and policies added as already held. They are not sales (reports
-- already leave them out, ADR-042) and filled the Won column after an import. Same function,
-- same signature; only the 'recent' filter changes. They stay in the table and the Clients tab.

create or replace function public.search_opportunities(
  p_query text default '',
  p_product_line text default null,
  p_outcome public.opportunity_outcome default null,
  p_stage_id uuid default null,
  p_closed text default 'all',
  p_sort text default 'updated',
  p_limit integer default 25,
  p_offset integer default 0,
  p_pipeline_id uuid default null
)
returns table (
  id uuid,
  contact_id uuid,
  product_line text,
  pipeline_id uuid,
  stage_id uuid,
  stage_name text,
  stage_position integer,
  stage_kind public.stage_kind,
  outcome public.opportunity_outcome,
  description text,
  quoted_carrier text,
  quote_sent_on date,
  estimated_annual_premium numeric,
  next_action text,
  effective_date date,
  renewal_date date,
  closed_at timestamptz,
  cycle integer,
  created_at timestamptz,
  updated_at timestamptz,
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as q,
      '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select o.id, o.contact_id, o.product_line, o.pipeline_id, o.stage_id, s.name, s.position, o.stage_kind, o.outcome,
    o.description, o.quoted_carrier, o.quote_sent_on, o.estimated_annual_premium, o.next_action,
    o.effective_date, o.renewal_date, o.closed_at, o.cycle, o.created_at, o.updated_at,
    c.contact_type, c.first_name, c.last_name, c.business_name
  from public.opportunities o
  join public.contacts c on c.id = o.contact_id
  join public.stages s on s.id = o.stage_id
  cross join params p
  where
    (
      p.q is null
      or concat_ws(' ', c.first_name, c.last_name) ilike p.pattern escape '\'
      or concat_ws(' ', c.last_name, c.first_name) ilike p.pattern escape '\'
      or c.business_name ilike p.pattern escape '\'
      or o.description ilike p.pattern escape '\'
      or o.quoted_carrier ilike p.pattern escape '\'
    )
    and (p_product_line is null or o.product_line = p_product_line)
    and (p_pipeline_id is null or o.pipeline_id = p_pipeline_id)
    and (p_outcome is null or o.outcome = p_outcome)
    and (p_stage_id is null or o.stage_id = p_stage_id)
    and case coalesce(p_closed, 'all')
          when 'none' then o.outcome in ('open', 'nurture')
          -- Board view: everything still being worked, plus won/lost in the last 30 days.
          -- Imported policies and existing policies are not sales: kept off the board (fix after Phase 25).
          when 'recent' then o.outcome in ('open', 'nurture')
            or (o.closed_at >= now() - interval '30 days' and o.import_batch_id is null and not o.existing_policy)
          else true
        end
  order by
    case when p_sort = 'name' then
      lower(coalesce(case when c.contact_type = 'business' then c.business_name end, c.last_name, c.first_name, c.business_name, ''))
    end,
    case when p_sort = 'premium' then o.estimated_annual_premium end desc nulls last,
    case when p_sort = 'created' then o.created_at end desc,
    case when p_sort = 'renewal' then o.renewal_date end nulls last,
    o.updated_at desc,
    o.id
  limit least(greatest(coalesce(p_limit, 25), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
