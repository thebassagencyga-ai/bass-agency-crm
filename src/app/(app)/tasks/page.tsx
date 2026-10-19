import type { Metadata } from "next";
import Link from "next/link";
import { TaskStatusButtons } from "@/components/tasks/status-buttons";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly, formatInstantDate, todayInZone } from "@/lib/dates";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getProfile, listTasks, taskCounts } from "@/lib/tasks/data";
import { parseTaskListParams, type TaskListParams } from "@/lib/tasks/params";
import { notStartedYet } from "@/lib/tasks/schedule";
import { CATEGORY_LABELS, PRIORITY_LABELS, TASK_CATEGORIES, TASK_PRIORITIES, TASK_VIEWS, VIEW_LABELS, type TaskListRow, type TaskView } from "@/lib/tasks/types";

export const metadata: Metadata = { title: "Tasks · ZeroLapse CRM" };

const CONTROL =
  "min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  completed: { text: "Task completed.", tone: "ok" },
  reopened: { text: "Task reopened.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

const EMPTY: Record<TaskView, string> = {
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  upcoming: "Nothing coming up.",
  done: "No completed tasks yet.",
};

function href(p: TaskListParams, overrides: Partial<TaskListParams> = {}): string {
  const next = { ...p, ...overrides };
  const qs = new URLSearchParams({ view: next.view });
  if (next.line) qs.set("line", next.line);
  if (next.priority) qs.set("priority", next.priority);
  if (next.category) qs.set("category", next.category);
  if (next.page > 1) qs.set("page", String(next.page));
  return `/tasks?${qs.toString()}`;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = parseTaskListParams(raw);
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const [{ rows, hasMore }, counts] = await Promise.all([listTasks(supabase, params, today), taskCounts(supabase, today)]);
  const filtered = Boolean(params.line || params.priority || params.category);
  const noticeKey = Object.keys(NOTICES).find((k) => raw[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const back = href(params);
  const countFor: Partial<Record<TaskView, number>> = { overdue: counts.overdue, today: counts.today, upcoming: counts.upcoming };

  return (
    <section className="flex max-w-4xl flex-col gap-4">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}>
          {notice.text}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link href="/tasks/new" className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900">Add task</Link>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">Today is {formatDateOnly(today)} (New York time).</p>

      <nav aria-label="Task views" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {TASK_VIEWS.map((v) => (
          <Link
            key={v}
            href={href(params, { view: v, page: 1 })}
            aria-current={params.view === v ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center gap-1 rounded-md border px-3 text-sm font-medium aria-[current=page]:border-slate-900 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white dark:aria-[current=page]:bg-slate-100 dark:aria-[current=page]:text-slate-900 ${v === "overdue" && counts.overdue > 0 ? "border-red-300 text-red-800 dark:text-red-300" : "border-slate-300 dark:border-slate-600"}`}
          >
            {VIEW_LABELS[v]}
            {countFor[v] !== undefined ? <span>({countFor[v]})</span> : null}
          </Link>
        ))}
      </nav>

      <form method="get" action="/tasks" className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <input type="hidden" name="view" value={params.view} />
        <details open={filtered}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Filters{filtered ? " (on)" : ""}</summary>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">Product line
              <select name="line" defaultValue={params.line ?? ""} className={CONTROL}>
                <option value="">All</option>
                {PRODUCT_LINES.map((l) => <option key={l} value={l}>{PRODUCT_LINE_NAMES[l]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Priority
              <select name="priority" defaultValue={params.priority ?? ""} className={CONTROL}>
                <option value="">All</option>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Type
              <select name="category" defaultValue={params.category ?? ""} className={CONTROL}>
                <option value="">All</option>
                {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="submit" className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Apply</button>
            {filtered ? <Link href={`/tasks?view=${params.view}`} className="flex min-h-11 items-center px-3 underline">Clear</Link> : null}
          </div>
        </details>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-600 dark:text-slate-400">{filtered ? "No tasks match these filters." : EMPTY[params.view]}</p>
      ) : (
        <ul aria-label={`${VIEW_LABELS[params.view]} tasks`} className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {rows.map((t) => <TaskRow key={t.id} task={t} today={today} back={back} />)}
        </ul>
      )}
      {params.page > 1 || hasMore ? (
        <nav aria-label="Pages" className="flex justify-between">
          {params.page > 1 ? <Link href={href(params, { page: params.page - 1 })} className="min-h-11 py-2 underline">← Previous</Link> : <span />}
          {hasMore ? <Link href={href(params, { page: params.page + 1 })} className="min-h-11 py-2 underline">Next →</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}

function TaskRow({ task, today, back }: { task: TaskListRow; today: string; back: string }) {
  const when =
    task.status === "completed" ? `Completed ${formatInstantDate(task.completed_at)}`
    : task.status === "cancelled" ? `Cancelled ${formatInstantDate(task.cancelled_at)}`
    : notStartedYet(task, today) ? `Starts ${formatDateOnly(task.start_date)} · due ${formatDateOnly(task.due_date)}`
    : `Due ${formatDateOnly(task.due_date)}`;
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={`/tasks/${task.id}`} className={`flex min-h-11 items-center font-medium break-words underline-offset-2 hover:underline ${task.status === "cancelled" ? "line-through" : ""}`}>{task.title}</Link>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {contactDisplayName(task)} · {when}
          {task.priority === "high" ? <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">High</span> : null}
          {task.product_line ? <span className="ml-2">{PRODUCT_LINE_NAMES[task.product_line]}</span> : null}
        </p>
      </div>
      <TaskStatusButtons id={task.id} status={task.status} back={back} compact />
    </li>
  );
}
