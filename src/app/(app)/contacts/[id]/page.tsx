import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchivedBadge, MergedBadge, StatusBadge, TagList } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { findDuplicates, getContact, getReferrals } from "@/lib/contacts/data";
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
import { HouseholdSection, VehiclesSection } from "@/components/contacts/detail-sections";
import { listHousehold, listVehicles } from "@/lib/contacts/details-data";
import { MessageComposer } from "@/components/messages/message-composer";
import { QuickActions } from "@/components/contacts/quick-actions";
import { quickActions } from "@/lib/contacts/quick-actions";
import { aiEnabled } from "@/lib/ai/config";
import { LogActivityWithAi } from "@/components/ai/log-activity-with-ai";
import { isTemplateKey, TEMPLATE_KEYS, TEMPLATES, templateForOpportunity, valuesFor } from "@/lib/messages/templates";

export const metadata: Metadata = { title: "Contact · Producr CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Contact saved.", tone: "ok" },
  logged: { text: "Activity logged.", tone: "ok" },
  followup: { text: "Follow-up task added.", tone: "ok" },
  followupnone: { text: "No follow-up was added (the rule is off or one already exists).", tone: "ok" },
  completed: { text: "Task completed.", tone: "ok" },
  reopened: { text: "Task reopened.", tone: "ok" },
  archived: { text: "Contact archived. It is hidden from the contact list but nothing was deleted.", tone: "ok" },
  restored: { text: "Contact restored.", tone: "ok" },
  detailsaved: { text: "Saved.", tone: "ok" },
  detailremoved: { text: "Removed. It is kept in the history, not deleted.", tone: "ok" },
  merged: { text: "Contacts merged. Everything from the duplicate is now here; the duplicate is archived.", tone: "ok" },
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

  const merged = contact.merged_into_contact_id;
  const ai = aiEnabled();
  // With AI helpers connected, the activity form can be filled in from rough notes (Phase 19).
  const LogForm = ai ? LogActivityWithAi : LogActivityForm;
  const [referrer, referrals, opportunities, stages, tasks, activities, profile, household, vehicles, mergedInto, duplicates] = await Promise.all([
    contact.referred_by_contact_id ? getContact(supabase, contact.referred_by_contact_id) : Promise.resolve(null),
    getReferrals(supabase, contact.id),
    listForContact(supabase, contact.id),
    getStages(supabase),
    tasksForContact(supabase, contact.id),
    activitiesForContact(supabase, contact.id),
    getProfile(supabase, userId),
    listHousehold(supabase, contact.id),
    listVehicles(supabase, contact.id),
    merged ? getContact(supabase, merged) : Promise.resolve(null),
    // Possible duplicates still active, for the merge hint (Phase 17).
    merged || contact.archived_at ? Promise.resolve([]) : findDuplicates(supabase, contact.email, contact.phone, contact.id),
  ]);
  const activeDuplicates = duplicates.filter((d) => !d.archived);
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

  // Text or email (Phase 16): ?message=<template>&opp=<id> opens the composer about an opportunity;
  // ?log=email|text_message&about=<template> opens the activity form ready to log what was sent.
  const aboutOpp = opportunities.find((o) => o.id === query.opp) ?? null;
  const messageKey = isTemplateKey(query.message) ? query.message : aboutOpp ? templateForOpportunity(aboutOpp) : "checkin";
  const logType = query.log === "email" || query.log === "text_message" ? query.log : null;
  const logDefaults = logType
    ? {
        activity_type: logType,
        opportunity_id: aboutOpp?.id,
        notes: `${logType === "email" ? "Emailed" : "Texted"}: ${isTemplateKey(query.about) ? TEMPLATES[query.about].label : "message"}.`,
      }
    : undefined;
  const address = [contact.address_line1, contact.address_line2, [contact.city, contact.state].filter(Boolean).join(", "), contact.postal_code]
    .filter((p) => p && p.trim())
    .join(", ");

  const rows: [string, React.ReactNode][] = [
    ["Type", contact.contact_type === "business" ? "Business" : "Individual"],
    ...(person ? [["Contact person", person] as [string, React.ReactNode]] : []),
    ["Phone", contact.phone ? <a href={`tel:${contact.phone}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{contact.phone}</a> : "—"],
    ...(contact.alt_phone ? [["Other phone", <a key="alt" href={`tel:${contact.alt_phone}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{contact.alt_phone}</a>] as [string, React.ReactNode]] : []),
    ["Email", contact.email ? <a href={`mailto:${contact.email}`} className="inline-flex min-h-11 min-w-11 items-center break-all underline text-link">{contact.email}</a> : "—"],
    ["Address", address || "—"],
    ["Prefers", contact.preferred_contact_method ? CONTACT_METHOD_LABELS[contact.preferred_contact_method] : "—"],
    ["Lead source", contact.lead_source ?? "—"],
    ["Tags", contact.tags.length > 0 ? <TagList tags={contact.tags} linked /> : "—"],
    ["Referred by", referrer ? <Link href={`/contacts/${referrer.id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{contactDisplayName(referrer)}</Link> : "—"],
    ["Google review", contact.google_review_left_on ? `Left on ${formatDateOnly(contact.google_review_left_on)}` : "Not recorded"],
    ["Added", formatInstantDate(contact.created_at)],
    ["Last updated", formatInstantDate(contact.updated_at)],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Link href="/contacts" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Contacts</Link>
        <h1 className="text-2xl font-bold tracking-tight break-words">{contactDisplayName(contact)}</h1>
        <div className="flex gap-1">
          <StatusBadge status={contact.relationship_status} />
          {merged ? <MergedBadge /> : contact.archived_at ? <ArchivedBadge /> : null}
        </div>
        {merged ? (
          <p role="status" className="rounded-md bg-subtle p-3 text-sm">
            This contact was merged into{" "}
            <Link href={`/contacts/${merged}`} className="font-medium underline text-link">{mergedInto ? contactDisplayName(mergedInto) : "another contact"}</Link>.
            Its opportunities, tasks, history, household and vehicles are there now. This record is kept for reference.
          </p>
        ) : null}
        {activeDuplicates.length > 0 ? (
          <div role="note" className="flex flex-col gap-1 rounded-md border border-caution bg-caution-soft p-3 text-sm text-caution">
            <p className="font-medium">Possible duplicate (same email or phone):</p>
            <ul className="flex flex-col">
              {activeDuplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/contacts/${contact.id}/merge?with=${d.id}`} className="inline-flex min-h-11 items-center underline text-link">Compare and merge with {d.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {merged ? null : <div className="flex flex-wrap gap-2">
          <Link href={`/contacts/${contact.id}/edit`} className="flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Edit</Link>
          {contact.archived_at ? (
            <form action={setContactArchived}>
              <input type="hidden" name="id" value={contact.id} />
              <input type="hidden" name="archive" value="0" />
              <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Restore contact</button>
            </form>
          ) : (
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-line-strong px-4 font-medium">Archive…</summary>
              <form action={setContactArchived} className="mt-2 flex flex-col gap-2 rounded-md border border-line-strong p-3 text-sm">
                <p>Archiving hides this contact from the list. Nothing is deleted and you can restore it any time.</p>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="archive" value="1" />
                <button type="submit" className="min-h-11 rounded-md bg-caution px-4 font-medium text-card">Archive contact</button>
              </form>
            </details>
          )}
          {contact.archived_at ? null : (
            <Link href={`/contacts/${contact.id}/merge`} className="flex min-h-11 items-center rounded-md border border-line-strong px-4 font-medium">Merge…</Link>
          )}
        </div>}
      </div>

      <QuickActions actions={quickActions({
        name: contactDisplayName(contact), phone: contact.phone, email: contact.email,
        archived: Boolean(contact.archived_at), merged: Boolean(merged),
      })} />

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-muted">{label}</dt>
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
          <p className="text-sm text-muted">None recorded yet.</p>
        ) : (
          <ul className="list-disc pl-5">
            {referrals.map((r) => (
              <li key={r.id}><Link href={`/contacts/${r.id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{r.label}</Link></li>
            ))}
          </ul>
        )}
      </section>

      <HouseholdSection contactId={contact.id} members={household} editable={!contact.archived_at} />
      <VehiclesSection contactId={contact.id} vehicles={vehicles} editable={!contact.archived_at} />

      <section aria-labelledby="opps-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="opps-heading" className="text-lg font-semibold">Opportunities</h2>
          {contact.archived_at ? null : (
            <Link href={`/opportunities/new?contact=${contact.id}`} className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">
              Add opportunity
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul aria-label="Opportunities for this contact" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
            {opportunities.map((o) => (
              <li key={o.id}>
                <Link href={`/opportunities/${o.id}`} className="flex min-h-11 flex-wrap items-center gap-2 p-3 hover:bg-subtle">
                  <span className="font-medium">{PRODUCT_LINE_NAMES[o.product_line]}</span>
                  <span className="text-sm">{stageName.get(o.stage_id)}</span>
                  <OutcomeBadge outcome={o.outcome} />
                  {o.policy_ended_on ? <span className="text-sm text-muted">Policy ended {formatDateOnly(o.policy_ended_on)}</span> : null}
                  {o.estimated_annual_premium !== null ? <span className="text-sm">{formatMoney(o.estimated_annual_premium, { whole: true })}/yr</span> : null}
                  {o.description ? <span className="w-full text-sm break-words text-muted">{o.description}</span> : null}
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
        <section id="follow-up-offer" aria-labelledby="offer-heading" className="flex flex-col gap-2 rounded-md border border-caution bg-caution-soft p-3 text-caution">
          <h2 id="offer-heading" className="font-semibold">No response — follow up again?</h2>
          <p className="text-sm">Adds a follow-up task using your &quot;no response&quot; rule (Settings).</p>
          <div className="flex flex-wrap gap-2">
            <form action={confirmNoResponseFollowUp}>
              <input type="hidden" name="activity_id" value={query.noresponse} />
              <input type="hidden" name="contact_id" value={contact.id} />
              <button type="submit" className="min-h-11 rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Add follow-up task</button>
            </form>
            <Link href={`/contacts/${contact.id}`} className="flex min-h-11 items-center px-3 underline text-link">Not now</Link>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tasks-heading" className="text-lg font-semibold">Open tasks</h2>
          <Link href={`/tasks/new?contact=${contact.id}`} className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Add task</Link>
        </div>
        {openTasks.length === 0 ? (
          <p className="text-sm text-muted">No open tasks.</p>
        ) : (
          <ul aria-label="Open tasks for this contact" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
            {openTasks.map((t) => {
              const view = taskView(t, today);
              return (
                <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/tasks/${t.id}`} className="flex min-h-11 items-center font-medium break-words underline-offset-2 hover:underline">{t.title}</Link>
                    <span className={`text-sm ${view === "overdue" ? "text-bad" : "text-muted"}`}>
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

      {contact.archived_at ? null : (
        <details id="message" open={Boolean(query.message)} className="scroll-mt-20 rounded-md border border-line p-3 bg-card">
          <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Text or email…</summary>
          <MessageComposer
            phone={contact.phone} email={contact.email}
            values={valuesFor(contact, profile.display_name, aboutOpp, formatDateOnly)}
            templates={TEMPLATE_KEYS.filter((k) => k !== "intake_reply")} initial={messageKey}
            logHref={`/contacts/${contact.id}${aboutOpp ? `?opp=${aboutOpp.id}` : ""}`}
            ai={ai ? { contactId: contact.id, opportunityId: aboutOpp?.id ?? null } : null}
          />
        </details>
      )}

      <details id="log-activity" open={Boolean(logDefaults)} className="scroll-mt-20 rounded-md border border-line p-3 bg-card">
        <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Log activity…</summary>
        <LogForm
          key={logDefaults ? `${logDefaults.activity_type}-${query.about ?? ""}-${aboutOpp?.id ?? ""}` : "log"}
          contactId={contact.id}
          now={isoToZonedLocal(new Date().toISOString(), profile.time_zone)}
          opportunities={opportunities.map((o) => ({ id: o.id, label: [PRODUCT_LINE_NAMES[o.product_line], o.description].filter(Boolean).join(" · ") }))}
          openTasks={openTasks.map((t) => ({ id: t.id, label: t.title }))}
          defaults={logDefaults}
        />
      </details>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ol aria-label="History for this contact" className="flex flex-col gap-3 border-l-2 border-line pl-4">
            {history.map((h) => (
              <li key={h.key} className="flex flex-col">
                <span className="text-xs text-muted">{formatInstantDateTime(h.at, profile.time_zone)}</span>
                {h.href ? <Link href={h.href} className="flex min-h-11 items-center font-medium break-words underline text-link">{h.title}</Link> : <span className="font-medium break-words">{h.title}</span>}
                {h.detail ? <span className="text-sm whitespace-pre-wrap break-words text-fg">{h.detail}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
