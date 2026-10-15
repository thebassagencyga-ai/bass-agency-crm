-- Phase 5: task lists.
--
-- "Today" is passed in by the app, computed in the user's time zone (ADR-007), so the
-- database never uses the server's UTC date. Both functions are SECURITY INVOKER with an
-- empty search_path: row level security (owner + two-step) filters every row.
--
-- Views (open tasks only, except 'done'):
--   overdue   due before today
--   today     due today
--   upcoming  due after today (includes tasks whose start date has not arrived yet;
--             those never appear in overdue/today because start_date <= due_date)
--   done      completed or cancelled, most recent first

create function public.search_tasks(
  p_view text,
  p_today date,
  p_product_line text default null,
  p_priority public.task_priority default null,
  p_category public.task_category default null,
  p_contact_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  contact_id uuid,
  opportunity_id uuid,
  title text,
  description text,
  due_date date,
  start_date date,
  priority public.task_priority,
  category public.task_category,
  status public.task_status,
  completed_at timestamptz,
  cancelled_at timestamptz,
  origin public.task_origin,
  created_at timestamptz,
  contact_type public.contact_type,
  first_name text,
  last_name text,
  business_name text,
  phone text,
  product_line text
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.contact_id, t.opportunity_id, t.title, t.description, t.due_date, t.start_date,
    t.priority, t.category, t.status, t.completed_at, t.cancelled_at, t.origin, t.created_at,
    c.contact_type, c.first_name, c.last_name, c.business_name, c.phone, o.product_line
  from public.tasks t
  join public.contacts c on c.id = t.contact_id
  left join public.opportunities o on o.id = t.opportunity_id
  where
    case p_view
      when 'overdue' then t.status = 'open' and t.due_date < p_today
      when 'today' then t.status = 'open' and t.due_date = p_today
      when 'upcoming' then t.status = 'open' and t.due_date > p_today
      when 'done' then t.status in ('completed', 'cancelled')
      else false
    end
    and (p_product_line is null or o.product_line = p_product_line)
    and (p_priority is null or t.priority = p_priority)
    and (p_category is null or t.category = p_category)
    and (p_contact_id is null or t.contact_id = p_contact_id)
  order by
    case when p_view = 'done' then coalesce(t.completed_at, t.cancelled_at) end desc,
    case when p_view <> 'done' then t.due_date end,
    case t.priority when 'high' then 0 when 'normal' then 1 else 2 end,
    t.created_at,
    t.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.search_tasks is
  'Task lists (Phase 5). SECURITY INVOKER: RLS limits results to the caller''s own tasks.';

create function public.task_counts(p_today date)
returns table (overdue bigint, due_today bigint, upcoming bigint)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where t.due_date < p_today),
    count(*) filter (where t.due_date = p_today),
    count(*) filter (where t.due_date > p_today)
  from public.tasks t
  where t.status = 'open';
$$;

comment on function public.task_counts is
  'Open task counts for the task tabs (Phase 5). SECURITY INVOKER.';

revoke all on function public.search_tasks(text, date, text, public.task_priority, public.task_category, uuid, integer, integer) from public, anon;
revoke all on function public.task_counts(date) from public, anon;
grant execute on function public.search_tasks(text, date, text, public.task_priority, public.task_category, uuid, integer, integer) to authenticated;
grant execute on function public.task_counts(date) to authenticated;
