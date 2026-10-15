-- Phase 7: dashboard summary in one round trip (fast on a phone).
--
-- SECURITY INVOKER with an empty search_path: row level security (owner + two-step) filters
-- every row, so each count and list covers only the caller's own records. "Today" is passed
-- in by the app, computed in the user's time zone (ADR-007, ADR-021).

create function public.dashboard_summary(p_today date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tasks', (
      select jsonb_build_object(
        'overdue', count(*) filter (where t.due_date < p_today),
        'due_today', count(*) filter (where t.due_date = p_today),
        'upcoming_7_days', count(*) filter (where t.due_date > p_today and t.due_date <= p_today + 7)
      )
      from public.tasks t
      where t.status = 'open'
    ),
    'open_by_line', coalesce((
      select jsonb_agg(row_to_json(x) order by x.product_line)
      from (
        select o.product_line,
          count(*) filter (where o.outcome = 'open') as open_count,
          count(*) filter (where o.outcome = 'nurture') as nurture_count,
          coalesce(sum(o.estimated_annual_premium), 0) as premium
        from public.opportunities o
        where o.outcome in ('open', 'nurture')
        group by o.product_line
      ) x
    ), '[]'::jsonb),
    'renewals', jsonb_build_object(
      'next_60_days', (
        select count(*) from public.opportunities o
        where o.renewal_date between p_today and p_today + 60 and o.outcome <> 'lost'
      ),
      'soonest', coalesce((
        select jsonb_agg(row_to_json(r) order by r.renewal_date, r.id)
        from (
          select o.id, o.product_line, o.renewal_date, o.outcome,
            c.contact_type, c.first_name, c.last_name, c.business_name
          from public.opportunities o
          join public.contacts c on c.id = o.contact_id
          where o.renewal_date between p_today and p_today + 60 and o.outcome <> 'lost'
          order by o.renewal_date, o.id
          limit 5
        ) r
      ), '[]'::jsonb)
    ),
    'recent_activity', coalesce((
      select jsonb_agg(row_to_json(a) order by a.occurred_at desc, a.id)
      from (
        select x.id, x.contact_id, x.activity_type, x.outcome, x.occurred_at, x.notes,
          c.contact_type, c.first_name, c.last_name, c.business_name
        from public.activities x
        join public.contacts c on c.id = x.contact_id
        order by x.occurred_at desc, x.id
        limit 8
      ) a
    ), '[]'::jsonb)
  );
$$;

comment on function public.dashboard_summary is
  'Dashboard counts and short lists (Phase 7). SECURITY INVOKER: RLS limits it to the caller''s rows.';
revoke all on function public.dashboard_summary(date) from public, anon;
grant execute on function public.dashboard_summary(date) to authenticated;
