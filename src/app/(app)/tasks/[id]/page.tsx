import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageBox } from "@/components/tasks/message-box";
import { TaskStatusButtons } from "@/components/tasks/status-buttons";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly, formatInstantDate, todayInZone } from "@/lib/dates";
import { getOpportunity } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getProfile, getTask, messageTemplates } from "@/lib/tasks/data";
import { messageRuleFor, renderMessage, smsHref } from "@/lib/tasks/message";
import { mailtoHref } from "@/lib/messages/links";
import { templateForTaskCategory } from "@/lib/messages/templates";
import { notStartedYet, taskView } from "@/lib/tasks/schedule";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/tasks/types";

export const metadata: Metadata = { title: "Task · Producr CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Task saved.", tone: "ok" },
  completed: { text: "Task completed.", tone: "ok" },
  reopened: { text: "Task reopened.", tone: "ok" },
  cancelled: { text: "Task cancelled. It stays in the history.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

export default async function TaskPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const task = await getTask(supabase, id);
  if (!task) notFound();
  const [contact, opportunity, profile] = await Promise.all([
    getContact(supabase, task.contact_id),
    task.opportunity_id ? getOpportunity(supabase, task.opportunity_id) : Promise.resolve(null),
    getProfile(supabase, userId),
  ]);
  const today = todayInZone(profile.time_zone);
  const view = taskView(task, today);
  const rule = messageRuleFor(task.category);
  const template = rule ? (await messageTemplates(supabase))[rule] : undefined;
  const message = template
    ? renderMessage(template, { first_name: contact?.first_name ?? null, agent_name: profile.display_name, review_link: profile.google_review_url })
    : null;
  const noticeKey = Object.keys(NOTICES).find((k) => query[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const statusText =
    task.status === "completed" ? `Completed ${formatInstantDate(task.completed_at)}`
    : task.status === "cancelled" ? `Cancelled ${formatInstantDate(task.cancelled_at)}`
    : notStartedYet(task, today) ? `Starts ${formatDateOnly(task.start_date)}`
    : view === "overdue" ? "Overdue" : view === "today" ? "Due today" : "Upcoming";

  const rows: [string, React.ReactNode][] = [
    ["Contact", contact ? <Link href={`/contacts/${contact.id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{contactDisplayName(contact)}</Link> : "—"],
    ["Due", formatDateOnly(task.due_date)],
    ...(task.start_date ? [["Don't show before", formatDateOnly(task.start_date)] as [string, React.ReactNode]] : []),
    ["Priority", PRIORITY_LABELS[task.priority]],
    ["Type", CATEGORY_LABELS[task.category]],
    ...(opportunity ? [["Opportunity", <Link key="o" href={`/opportunities/${opportunity.id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{PRODUCT_LINE_NAMES[opportunity.product_line]}</Link>] as [string, React.ReactNode]] : []),
    ["Created", `${formatInstantDate(task.created_at)}${task.origin === "automation" ? " (automatic)" : ""}`],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
          {notice.text}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Link href="/tasks" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Tasks</Link>
        <h1 className={`text-2xl font-bold tracking-tight break-words ${task.status !== "open" ? "text-muted line-through" : ""}`}>{task.title}</h1>
        <p className={`text-sm font-medium ${view === "overdue" ? "text-bad" : ""}`}>{statusText}</p>
        <div className="flex flex-wrap gap-2">
          <TaskStatusButtons id={task.id} status={task.status} />
          <Link href={`/tasks/${task.id}/edit`} className="flex min-h-11 items-center rounded-md border border-line-strong px-4 font-medium">Edit</Link>
        </div>
      </div>
      {message ? (
        <MessageBox message={message} smsHref={smsHref(contact?.phone ?? null, message)} mailHref={mailtoHref(contact?.email ?? null, profile.display_name || "The Bass Agency", message)} />
      ) : contact && !contact.archived_at && task.status === "open" ? (
        <Link
          href={`/contacts/${contact.id}?message=${templateForTaskCategory(task.category)}${opportunity ? `&opp=${opportunity.id}` : ""}#message`}
          className="flex min-h-11 w-fit items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium"
        >
          Text or email {contactDisplayName(contact)}
        </Link>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {task.description ? <p className="whitespace-pre-wrap break-words">{task.description}</p> : null}
    </section>
  );
}
