-- Phase 4: opportunities and pipelines.
--
-- 1. Optional quoted carrier (free text; no carrier integrations).
-- 2. Lifecycle rules enforced in the database, so no client can bypass them:
--    * the product line is fixed once created (stage changes stay within the same pipeline);
--    * `cycle` is maintained here only: 1 on insert, +1 when a won/lost opportunity is
--      reopened (automation keys include it, ADR-008), unchanged otherwise;
--    * reopening a lost opportunity clears its loss reason (the audit log keeps the old value).
-- 3. search_opportunities(): board and table data with the contact's name, SECURITY INVOKER
--    so row level security (owner + two-step) filters every row.

alter table public.opportunities
  add column quoted_carrier text check (char_length(quoted_carrier) between 1 and 100);

comment on column public.opportunities.quoted_carrier is 'Carrier quoted, as typed by the agent (optional).';

create function crm_private.opportunity_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.cycle := 1;
    return new;
  end if;

  if new.product_line is distinct from old.product_line then
    raise exception 'The product line of an opportunity cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if old.outcome in ('won', 'lost') and new.outcome in ('open', 'nurture') then
    new.cycle := old.cycle + 1;
  else
    new.cycle := old.cycle;
  end if;

  if old.outcome = 'lost' and new.outcome <> 'lost' then
    new.loss_reason := null;
    new.loss_reason_detail := null;
  end if;
  return new;
end;
$$;

revoke all on function crm_private.opportunity_lifecycle() from public, anon, authenticated;

-- Named so it fires after opportunities_a_stage_kind and before opportunities_closed_at.
create trigger opportunities_b_lifecycle before insert or update on public.opportunities
  for each row execute function crm_private.opportunity_lifecycle();

create function public.search_opportunities(
  p_query text default '',
  p_product_line text default null,
  p_outcome public.opportunity_outcome default null,
  p_stage_id uuid default null,
  p_closed text default 'all',
  p_sort text default 'updated',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  contact_id uuid,
  product_line text,
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
  select o.id, o.contact_id, o.product_line, o.stage_id, s.name, s.position, o.stage_kind, o.outcome,
    o.description, o.quoted_carrier, o.quote_sent_on, o.estimated_annual_premium, o.next_action,
    o.effective_date, o.renewal_date, o.closed_at, o.cycle, o.created_at, o.updated_at,
    c.contact_type, c.first_name, c.last_name, c.business_name
  from public.opportunities o
  join public.contacts c on c.id = o.contact_id
  join public.pipeline_stages s on s.id = o.stage_id
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
    and (p_outcome is null or o.outcome = p_outcome)
    and (p_stage_id is null or o.stage_id = p_stage_id)
    and case coalesce(p_closed, 'all')
          when 'none' then o.outcome in ('open', 'nurture')
          -- Board view: everything still being worked, plus won/lost in the last 30 days.
          when 'recent' then o.outcome in ('open', 'nurture') or o.closed_at >= now() - interval '30 days'
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

comment on function public.search_opportunities is
  'Opportunity board and table (Phase 4). SECURITY INVOKER: RLS limits results to the caller''s own rows.';

revoke all on function public.search_opportunities(text, text, public.opportunity_outcome, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.search_opportunities(text, text, public.opportunity_outcome, uuid, text, text, integer, integer) to authenticated;
