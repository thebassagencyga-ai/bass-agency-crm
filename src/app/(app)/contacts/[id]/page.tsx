import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchivedBadge, StatusBadge } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { getContact, getReferrals } from "@/lib/contacts/data";
import { contactDisplayName, contactPersonName } from "@/lib/contacts/format";
import { CONTACT_METHOD_LABELS } from "@/lib/contacts/types";
import { formatDateOnly, formatInstantDate } from "@/lib/dates";
import { OutcomeBadge } from "@/components/opportunities/badges";
import { getStages, listForContact } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { confirmNoResponseFollowUp } from "@/app/(app)/tasks/actions";
import { LogActivityForm } from "@/components/tasks/log-activity-form";
import { TaskStatusButtons } from "@/components/tasks/status-buttons";
import { activitiesForContact } from "@/lib/activities/data";
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_TYPE_LABELS } from "@/lib/activities/types";
import { formatInstantDateTime, isoToZonedLocal, todayInZone } from "@/lib/dates";
import { getProfile, tasksForContact } from "@/lib/tasks/data";
import { notStartedYet, taskView } from "@/lib/tasks/schedule";
import { setContactArchived } from "../actions";
import { CrossSellPromptList } from "@/components/cross-sell/prompt-list";
import { crossSellPrompts } from "@/lib/cross-sell/data";

export const metadata: Metadata = { title: "Contact · The Bass Agency CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Contact saved.", tone: "ok" },
  logged: { text: "Activity logged.", tone: "ok" },
  followup: { text: "Follow-up task added.", tone: "ok" },
  followupnone: { text: "No follow-up was added (the rule is off or one already exists).", tone: "ok" },
  completed: { text: "Task completed.", tone: "ok" },
  reopened: { text: "Task reopened.", tone: "ok" },
  archived: { text: "Contact archived. It is hidden from the contact list but nothing was deleted.", tone: "ok" },
  restored: { text: "Contact restored.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

export default async function ContactPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const contact = await getContact(supabase, id);
  if (!contact) notFound();

  const [referrer, referrals, opportunities, stages, tasks, activities, profile] = await Promise.all([
    contact.referred_by_contact_id ? getContact(supabase, contact.referred_by_contact_id) : Promise.resolve(null),
    getReferrals(supabase, contact.id),
    listForContact(supabase, contact.id),
    getStages(supabase),
    tasksForContact(supabase, contact.id),
    activitiesForContact(supabase, contact.id),
    getProfile(supabase, userId),
  ]);
  const today = todayInZone(profile.time_zone);
  const prompts = await crossSellPrompts(supabase, today, { contactId: contact.id });
  const openTasks = tasks.filter((t) => t.status === "open");
  const oppLabel = (id: string | null) => {
    const o = id ? opportunities.find((x) => x.id === id) : undefined;
    return o ? PRODUCT_LINE_NAMES[o.product_line] : null;
  };
  // History: activities plus finished tasks, newest first. Nothing here is ever deleted.
  const history = [
    ...activities.map((a) => ({
      key: `a-${a.id}`, at: a.occurred_at,
      title: ACTIVITY_TYPE_LABELS[a.activity_type] + (a.outcome ? ` — ${ACTIVITY_OUTCOME_LABELS[a.outcome]}` : ""),
      detail: [a.requested_follow_up_on ? `Follow up on ${formatDateOnly(a.requested_follow_up_on)}` : null, oppLabel(a.opportunity_id), a.notes].filter(Boolean).join(" · "),
      href: null as string | null,
    })),
    ...tasks.filter((t) => t.status !== "open").map((t) => ({
      key: `t-${t.id}`, at: (t.completed_at ?? t.cancelled_at)!,
      title: `Task ${t.status === "completed" ? "completed" : "cancelled"}: ${t.title}`,
      detail: oppLabel(t.opportunity_id) ?? "",
      href: `/tasks/${t.id}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const noticeKey = Object.keys(NOTICES).find((k) => query[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const person = contactPersonName(contact);
  const address = [contact.address_line1, contact.address_line2, [contact.city, contact.state].filter(Boolean).join(", "), contact.postal_code]
    .filter((p) => p && p.trim())
    .join(", ");

  const rows: [string, React.ReactNode][] = [
    ["Type", contact.contact_type === "business" ? "Business" : "Individual"],
    ...(person ? [["Contact person", person] as [string, React.ReactNode]] : []),
    ["Phone", contact.phone ? <a href={`tel:${contact.phone}`} className="underline">{contact.phone}</a> : "—"],
    ...(contact.alt_phone ? [["Other phone", <a key="alt" href={`tel:${contact.alt_phone}`} className="underline">{contact.alt_phone}</a>] as [string, React.ReactNode]] : []),
    ["Email", contact.email ? <a href={`mailto:${contact.email}`} className="break-all underline">{contact.email}</a> : "—"],
    ["Address", address || "—"],
    ["Prefers", contact.preferred_contact_method ? CONTACT_METHOD_LABELS[contact.preferred_contact_method] : "—"],
    ["Lead source", contact.lead_source ?? "—"],
    ["Referred by", referrer ? <Link href={`/contacts/${referrer.id}`} className="underline">{contactDisplayName(referrer)}</Link> : "—"],
    ["Google review", contact.google_review_left_on ? `Left on ${formatDateOnly(contact.google_review_left_on)}` : "Not recorded"],
    ["Added", formatInstantDate(contact.created_at)],
    ["Last updated", formatInstantDate(contact.updated_at)],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Link href="/contacts" className="w-fit text-sm underline">← Contacts</Link>
        <h1 className="text-2xl font-semibold break-words">{contactDisplayName(contact)}</h1>
        <div className="flex gap-1">
          <StatusBadge status={contact.relationship_status} />
          {contact.archived_at ? <ArchivedBadge /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contacts/${contact.id}/edit`} className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Edit</Link>
          {contact.archived_at ? (
            <form action={setContactArchived}>
              <input type="hidden" name="id" value={contact.id} />
              <input type="hidden" name="archive" value="0" />
              <button type="submit" className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Restore contact</button>
            </form>
          ) : (
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-400 px-4 font-medium">Archive…</summary>
              <form action={setContactArchived} className="mt-2 flex flex-col gap-2 rounded-md border border-slate-300 p-3 text-sm dark:border-slate-600">
                <p>Archiving hides this contact from the list. Nothing is deleted and you can restore it any time.</p>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="archive" value="1" />
                <button type="submit" className="min-h-11 rounded-md bg-amber-700 px-4 font-medium text-white">Archive contact</button>
              </form>
            </details>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {contact.notes ? (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-1">
          <h2 id="notes-heading" className="text-lg font-semibold">Notes</h2>
          <p className="whitespace-pre-wrap break-words">{contact.notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="referrals-heading" className="flex flex-col gap-1">
        <h2 id="referrals-heading" className="text-lg font-semibold">Referrals from this contact</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">None recorded yet.</p>
        ) : (
          <ul className="list-disc pl-5">
            {referrals.map((r) => (
              <li key={r.id}><Link href={`/contacts/${r.id}`} className="underline">{r.label}</Link></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="opps-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="opps-heading" className="text-lg font-semibold">Opportunities</h2>
          {contact.archived_at ? null : (
            <Link href={`/opportunities/new?contact=${contact.id}`} className="flex min-h-11 items-center rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">
              Add opportunity
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">None yet.</p>
        ) : (
          <ul aria-label="Opportunities for this contact" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {opportunities.map((o) => (
              <li key={o.id}>
                <Link href={`/opportunities/${o.id}`} className="flex min-h-11 flex-wrap items-center gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="font-medium">{PRODUCT_LINE_NAMES[o.product_line]}</span>
                  <span className="text-sm">{stageName.get(o.stage_id)}</span>
                  <OutcomeBadge outcome={o.outcome} />
                  {o.policy_ended_on ? <span className="text-sm text-slate-600 dark:text-slate-400">Policy ended {formatDateOnly(o.policy_ended_on)}</span> : null}
                  {o.estimated_annual_premium !== null ? <span className="text-sm">{formatMoney(o.estimated_annual_premium, { whole: true })}/yr</span> : null}
                  {o.description ? <span className="w-full text-sm break-words text-slate-600 dark:text-slate-400">{o.description}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {prompts.length > 0 || query.dismissed || query.dismisserror ? (
        <CrossSellPromptList
          prompts={prompts} back={`/contacts/${contact.id}`} showContact={false}
          notice={query.dismissed ? "dismissed" : query.dismisserror ? "dismisserror" : undefined}
        />
      ) : null}

      {query.noresponse && /^[0-9a-f-]{36}$/i.test(query.noresponse) ? (
        <section id="follow-up-offer" aria-labelledby="offer-heading" className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <h2 id="offer-heading" className="font-semibold">No response — follow up again?</h2>
          <p className="text-sm">Adds a follow-up task using your &quot;no response&quot; rule (Settings).</p>
          <div className="flex flex-wrap gap-2">
            <form action={confirmNoResponseFollowUp}>
              <input type="hidden" name="activity_id" value={query.noresponse} />
              <input type="hidden" name="contact_id" value={contact.id} />
              <button type="submit" className="min-h-11 rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Add follow-up task</button>
            </form>
            <Link href={`/contacts/${contact.id}`} className="flex min-h-11 items-center px-3 underline">Not now</Link>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tasks-heading" className="text-lg font-semibold">Open tasks</h2>
          <Link href={`/tasks/new?contact=${contact.id}`} className="flex min-h-11 items-center rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Add task</Link>
        </div>
        {openTasks.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No open tasks.</p>
        ) : (
          <ul aria-label="Open tasks for this contact" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {openTasks.map((t) => {
              const view = taskView(t, today);
              return (
                <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/tasks/${t.id}`} className="font-medium break-words underline-offset-2 hover:underline">{t.title}</Link>
                    <span className={`text-sm ${view === "overdue" ? "text-red-700 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
                      {notStartedYet(t, today) ? `Starts ${formatDateOnly(t.start_date)} · ` : ""}{view === "overdue" ? "Overdue · " : view === "today" ? "Today · " : ""}Due {formatDateOnly(t.due_date)}
                    </span>
                  </div>
                  <TaskStatusButtons id={t.id} status={t.status} back={`/contacts/${contact.id}`} compact />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details id="log-activity" className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Log activity…</summary>
        <LogActivityForm
          contactId={contact.id}
          now={isoToZonedLocal(new Date().toISOString(), profile.time_zone)}
          opportunities={opportunities.map((o) => ({ id: o.id, label: [PRODUCT_LINE_NAMES[o.product_line], o.description].filter(Boolean).join(" · ") }))}
          openTasks={openTasks.map((t) => ({ id: t.id, label: t.title }))}
        />
      </details>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nothing logged yet.</p>
        ) : (
          <ol aria-label="History for this contact" className="flex flex-col gap-3 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
            {history.map((h) => (
              <li key={h.key} className="flex flex-col">
                <span className="text-xs text-slate-500">{formatInstantDateTime(h.at, profile.time_zone)}</span>
                {h.href ? <Link href={h.href} className="font-medium break-words underline">{h.title}</Link> : <span className="font-medium break-words">{h.title}</span>}
                {h.detail ? <span className="text-sm whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{h.detail}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
