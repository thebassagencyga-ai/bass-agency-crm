import type { Metadata } from "next";
import Link from "next/link";
import { TaskStatusButtons } from "@/components/tasks/status-buttons";
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_TYPE_LABELS } from "@/lib/activities/types";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import { getDashboard } from "@/lib/dashboard";
import { formatDateOnly, formatInstantDateTime, todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getProfile, listTasks } from "@/lib/tasks/data";
import type { TaskListRow } from "@/lib/tasks/types";

export const metadata: Metadata = { title: "Dashboard · The Bass Agency CRM" };

const NOTICES: Record<string, string> = { completed: "Task completed.", reopened: "Task reopened." };
const ACTION = "flex min-h-11 items-center justify-center rounded-md px-3 text-center font-medium";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const base = { line: null, priority: null, category: null, page: 1 } as const;
  const [summary, overdue, dueToday] = await Promise.all([
    getDashboard(supabase, today),
    listTasks(supabase, { ...base, view: "overdue" }, today),
    listTasks(supabase, { ...base, view: "today" }, today),
  ]);
  const notice = Object.keys(NOTICES).find((k) => query[k]);
  const byLine = new Map(summary.open_by_line.map((r) => [r.product_line, r]));
  const firstName = profile.display_name.trim().split(/\s+/)[0];

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      {notice ? <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{NOTICES[notice]}</p> : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{firstName ? `Good to see you, ${firstName}` : "Today"}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{formatDateOnly(today)} · New York time</p>
      </div>

      <nav aria-label="Quick actions" className="grid grid-cols-3 gap-2">
        <Link href="/contacts/new" className={`${ACTION} bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900`}>Add contact</Link>
        <Link href="/activities/new" className={`${ACTION} border border-slate-900 dark:border-slate-100`}>Log activity</Link>
        <Link href="/tasks/new" className={`${ACTION} border border-slate-900 dark:border-slate-100`}>Add task</Link>
      </nav>

      <section aria-labelledby="task-counts-heading" className="flex flex-col gap-2">
        <h2 id="task-counts-heading" className="sr-only">Task counts</h2>
        <ul className="grid grid-cols-3 gap-2">
          {[
            { label: "Overdue", value: summary.tasks.overdue, href: "/tasks?view=overdue", alert: summary.tasks.overdue > 0 },
            { label: "Due today", value: summary.tasks.due_today, href: "/tasks?view=today", alert: false },
            { label: "Next 7 days", value: summary.tasks.upcoming_7_days, href: "/tasks?view=upcoming", alert: false },
          ].map((s) => (
            <li key={s.label}>
              <Link href={s.href} className={`flex min-h-20 flex-col justify-center rounded-md border p-3 ${s.alert ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100" : "border-slate-200 dark:border-slate-700"}`}>
                <span className="text-2xl font-semibold">{s.value}</span>
                <span className="text-sm">{s.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <TaskList id="overdue" title="Overdue" tasks={overdue.rows.slice(0, 5)} more={summary.tasks.overdue - 5} href="/tasks?view=overdue" empty="Nothing overdue." danger />
      <TaskList id="today" title="Due today" tasks={dueToday.rows.slice(0, 10)} more={summary.tasks.due_today - 10} href="/tasks?view=today" empty="Nothing due today." />

      <section aria-labelledby="pipeline-heading" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="pipeline-heading" className="text-lg font-semibold">Open opportunities</h2>
          <Link href="/opportunities?view=table&closed=none" className="flex min-h-11 items-center text-sm underline">See all</Link>
        </div>
        <ul aria-label="Open opportunities by product line" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRODUCT_LINES.map((line) => {
            const row = byLine.get(line);
            const open = row?.open_count ?? 0;
            const nurture = row?.nurture_count ?? 0;
            return (
              <li key={line}>
                <Link href={`/opportunities?line=${line}`} className="flex min-h-20 flex-col justify-center rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <span className="text-sm font-medium">{PRODUCT_LINE_NAMES[line]}</span>
                  <span className="text-2xl font-semibold">{open}</span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {nurture > 0 ? `+${nurture} nurture · ` : ""}{formatMoney(row?.premium ?? 0, { whole: true })}/yr est.
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="renewals-heading" className="flex flex-col gap-2">
        <h2 id="renewals-heading" className="text-lg font-semibold">Upcoming renewals</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{summary.renewals.next_60_days} in the next 60 days.</p>
        {summary.renewals.soonest.length === 0 ? null : (
          <ul aria-label="Soonest renewals" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {summary.renewals.soonest.map((r) => (
              <li key={r.id}>
                <Link href={`/opportunities/${r.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="font-medium">{contactDisplayName(r)} · {PRODUCT_LINE_NAMES[r.product_line]}</span>
                  <span className="text-sm">{formatDateOnly(r.renewal_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
        <h2 id="recent-heading" className="text-lg font-semibold">Recent activity</h2>
        {summary.recent_activity.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nothing logged yet. Use &quot;Log activity&quot; after a call or meeting.</p>
        ) : (
          <ul aria-label="Recent activity" className="flex flex-col gap-3">
            {summary.recent_activity.map((a) => (
              <li key={a.id} className="flex flex-col">
                <span className="text-xs text-slate-500">{formatInstantDateTime(a.occurred_at, profile.time_zone)}</span>
                <Link href={`/contacts/${a.contact_id}`} className="font-medium underline-offset-2 hover:underline">
                  {ACTIVITY_TYPE_LABELS[a.activity_type]} · {contactDisplayName(a)}
                </Link>
                {a.outcome ? <span className="text-sm text-slate-600 dark:text-slate-400">{ACTIVITY_OUTCOME_LABELS[a.outcome]}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function TaskList({ id, title, tasks, more, href, empty, danger = false }: { id: string; title: string; tasks: TaskListRow[]; more: number; href: string; empty: string; danger?: boolean }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className={`text-lg font-semibold ${danger && tasks.length > 0 ? "text-red-800 dark:text-red-300" : ""}`}>{title}</h2>
        <Link href={href} className="flex min-h-11 items-center text-sm underline">{more > 0 ? `See all (${more} more)` : "See all"}</Link>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{empty}</p>
      ) : (
        <ul aria-label={`${title} tasks`} className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-col">
                <Link href={`/tasks/${t.id}`} className="font-medium break-words underline-offset-2 hover:underline">{t.title}</Link>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {contactDisplayName(t)}{danger ? ` · due ${formatDateOnly(t.due_date)}` : ""}{t.priority === "high" ? " · High" : ""}
                </span>
              </div>
              <TaskStatusButtons id={t.id} status={t.status} back="/dashboard" compact />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
