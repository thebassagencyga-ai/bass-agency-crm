-- Phase 11 security and correctness review fixes.
--
-- Cross-sell: "lost in the last 12 months" compared the loss instant with the user's date
-- converted at the database server's midnight (UTC), so for a few hours each evening in New
-- York the window was off by a day. It now compares calendar dates in the user's time zone,
-- like every other date rule (ADR-007). Found by CI running just after midnight UTC.

create or replace function crm_engine.cross_sell_matches(p_today date, p_contact_id uuid default null)
returns table (
  contact_id uuid,
  rule_id uuid,
  rule_key text,
  rule_name text,
  reason text,
  lacks_line text,
  held_lines text[],
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text
)
language sql
stable
set search_path = ''
as $$
  with held as (
    select o.contact_id, array_agg(distinct o.product_line order by o.product_line) as lines
    from public.opportunities o
    where o.outcome = 'won' and o.policy_ended_on is null
      and (p_contact_id is null or o.contact_id = p_contact_id)
    group by o.contact_id
  )
  select c.id, r.id, r.rule_key, r.name, r.reason, r.lacks_line, h.lines,
    c.contact_type, c.first_name, c.last_name, c.business_name
  from held h
  join public.contacts c on c.id = h.contact_id
  join public.cross_sell_rules r
    on r.enabled
   and h.lines && r.has_any_lines
   and not (r.lacks_line = any (h.lines))
   and (r.contact_type is null or r.contact_type = c.contact_type)
  where c.archived_at is null
    and not exists (
      select 1 from public.opportunities x
      where x.contact_id = c.id and x.product_line = r.lacks_line
        and (x.outcome in ('open', 'nurture')
             or (x.outcome = 'lost'
                 and (x.closed_at at time zone coalesce(
                       (select p.time_zone from public.profiles p where p.id = auth.uid()), 'America/New_York'
                     ))::date > p_today - 365))
    )
    and not exists (
      select 1 from public.cross_sell_dismissals d
      where d.contact_id = c.id and d.rule_id = r.id and d.hidden_until > p_today
    );
$$;
