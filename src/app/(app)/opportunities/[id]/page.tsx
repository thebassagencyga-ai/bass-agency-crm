import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OutcomeBadge } from "@/components/opportunities/badges";
import { MarkLostForm, MoveStageForm } from "@/components/opportunities/stage-forms";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly, formatInstantDate, todayInZone } from "@/lib/dates";
import { getOpportunity, getPipelines, getStages, stagesFor } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { canToggleNurture } from "@/lib/opportunities/transitions";
import { LOSS_REASON_LABELS } from "@/lib/opportunities/types";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { RenewalHistory } from "@/components/renewals/history";
import { termLabel } from "@/lib/renewals";
import { outcomesFor } from "@/lib/renewals/data";
import { getProfile, tasksForOpportunity } from "@/lib/tasks/data";
import { CATEGORY_LABELS } from "@/lib/tasks/types";
import { setNurture } from "../actions";
import { templateForOpportunity } from "@/lib/messages/templates";

export const metadata: Metadata = { title: "Opportunity · Producr CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Opportunity saved.", tone: "ok" },
  existing: { text: "Policy added. The contact is a client; only the renewal review was scheduled.", tone: "ok" },
  moved: { text: "Stage updated.", tone: "ok" },
  won: { text: "Marked as won. Prospecting tasks were closed and onboarding, review and referral tasks added (per your Settings). The contact is now a client.", tone: "ok" },
  lost: { text: "Marked as lost. Its prospecting tasks were closed. The record is kept and can be reopened later.", tone: "ok" },
  reopened: { text: "Opportunity reopened. Its history is kept and a new follow-up task was added.", tone: "ok" },
  nurture: { text: "Moved to nurture.", tone: "ok" },
  unnurture: { text: "Back to open.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

export default async function OpportunityPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const opp = await getOpportunity(supabase, id);
  if (!opp) notFound();
  const [contact, allStages, pipelines, tasks, renewals, profile, pipelineRow] = await Promise.all([
    getContact(supabase, opp.contact_id), getStages(supabase), getPipelines(supabase), tasksForOpportunity(supabase, opp.id), outcomesFor(supabase, opp.id),
    getProfile(supabase, userId),
    // Its own pipeline, even if archived since (a won policy keeps its history there).
    supabase.from("pipelines").select("name, archived_at").eq("id", opp.pipeline_id).maybeSingle(),
  ]);
  const pipelineName = (pipelineRow.data?.name as string | undefined) ?? "Pipeline";
  const pipelineArchived = Boolean(pipelineRow.data?.archived_at);
  const today = todayInZone(profile.time_zone);
  const activePolicy = opp.outcome === "won" && opp.policy_ended_on === null;
  const stages = stagesFor(allStages, opp.pipeline_id).filter((s) => !s.archived_at);
  const stage = allStages.find((s) => s.id === opp.stage_id);
  const lostStage = stages.find((s) => s.kind === "lost");
  const otherPipelines = pipelines.filter((p) => p.id !== opp.pipeline_id);
  const noticeKey = Object.keys(NOTICES).find((k) => query[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const name = contact ? contactDisplayName(contact) : "Contact";

  const rows: [string, React.ReactNode][] = [
    ["Contact", contact ? <Link href={`/contacts/${contact.id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{name}</Link> : "—"],
    ["Product line", PRODUCT_LINE_NAMES[opp.product_line]],
    ["Pipeline", pipelineArchived ? `${pipelineName} (archived)` : pipelineName],
    ["Stage", stage?.name ?? "—"],
    ["Description", opp.description ?? "—"],
    ["Next action", opp.next_action ?? "—"],
    ["Quoted carrier", opp.quoted_carrier ?? "—"],
    ["Quote sent", formatDateOnly(opp.quote_sent_on) || "—"],
    ["Est. annual premium", formatMoney(opp.estimated_annual_premium) || "—"],
    ["Effective date", formatDateOnly(opp.effective_date) || "—"],
    ["Renewal date", formatDateOnly(opp.renewal_date) || "—"],
    ...(opp.current_carrier || opp.current_policy_renews_on
      ? [["Current coverage", [opp.current_carrier, opp.current_policy_renews_on ? `renews ${formatDateOnly(opp.current_policy_renews_on)}` : null].filter(Boolean).join(", ")] as [string, React.ReactNode]]
      : []),
    ...(opp.product_line === "auto" ? [["Policy term", termLabel(opp.policy_term_months)] as [string, React.ReactNode]] : []),
    ...(opp.policy_ended_on ? [["Policy ended", formatDateOnly(opp.policy_ended_on)] as [string, React.ReactNode]] : []),
    ...(opp.outcome === "lost" && opp.loss_reason
      ? [["Loss reason", [LOSS_REASON_LABELS[opp.loss_reason], opp.loss_reason_detail].filter(Boolean).join(" — ")] as [string, React.ReactNode]]
      : []),
    ...(opp.existing_policy
      ? [["Added as", "A policy the client already had"] as [string, React.ReactNode]]
      : opp.closed_at ? [["Closed", formatInstantDate(opp.closed_at)] as [string, React.ReactNode]] : []),
    ...(opp.cycle > 1 ? [["Times reopened", String(opp.cycle - 1)] as [string, React.ReactNode]] : []),
    ["Added", formatInstantDate(opp.created_at)],
    ["Last updated", formatInstantDate(opp.updated_at)],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Link href={pipelineArchived ? "/opportunities" : `/opportunities?pipeline=${opp.pipeline_id}`} className="flex min-h-11 w-fit items-center text-sm underline text-link">← {pipelineArchived ? "Pipelines" : pipelineName}</Link>
        <h1 className="text-2xl font-bold tracking-tight break-words">{PRODUCT_LINE_NAMES[opp.product_line]} · {name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <OutcomeBadge outcome={opp.outcome} />
          <span className="text-sm text-muted">{stage?.name}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/opportunities/${opp.id}/edit`} className="flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Edit details</Link>
          {contact && !contact.archived_at ? (
            <Link href={`/contacts/${contact.id}?message=${templateForOpportunity(opp)}&opp=${opp.id}#message`} className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">
              Text or email
            </Link>
          ) : null}
          {canToggleNurture(opp.outcome, opp.stage_kind) ? (
            <form action={setNurture}>
              <input type="hidden" name="id" value={opp.id} />
              <input type="hidden" name="nurture" value={opp.outcome === "nurture" ? "0" : "1"} />
              <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">
                {opp.outcome === "nurture" ? "Back to open" : "Move to nurture"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {activePolicy && opp.renewal_date ? (
        <Link href={`/renewals/${opp.id}`} className="flex min-h-11 w-fit items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">
          Record renewal outcome
        </Link>
      ) : null}
      {opp.outcome === "won" ? <RenewalHistory outcomes={renewals} /> : null}

      <section aria-labelledby="opp-tasks-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="opp-tasks-heading" className="text-lg font-semibold">Tasks</h2>
          <Link href={`/tasks/new?contact=${opp.contact_id}`} className="flex min-h-11 items-center underline text-link">Add task</Link>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted">No tasks for this opportunity.</p>
        ) : (
          <ul aria-label="Tasks for this opportunity" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-col p-3">
                <Link href={`/tasks/${t.id}`} className={`flex min-h-11 items-center font-medium break-words underline-offset-2 hover:underline ${t.status !== "open" ? "text-muted line-through" : ""}`}>{t.title}</Link>
                <span className="text-sm text-muted">
                  {t.status === "open" ? `Due ${formatDateOnly(t.due_date)}` : t.status === "completed" ? "Completed" : "Closed"} · {CATEGORY_LABELS[t.category]}{t.origin === "automation" ? " · automatic" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="stage-heading" className="flex flex-col gap-3 rounded-md border border-line p-3 bg-card">
        <h2 id="stage-heading" className="text-lg font-semibold">{opp.outcome === "won" || opp.outcome === "lost" ? "Reopen" : "Change stage"}</h2>
        <MoveStageForm id={opp.id} stages={stages} otherPipelines={otherPipelines} currentStageId={opp.stage_id} outcome={opp.outcome} quoteSentOn={opp.quote_sent_on} today={today} />
      </section>

      {opp.outcome !== "lost" && lostStage ? (
        <details id="mark-lost" open={query.mark === "lost"} className="rounded-md border border-line p-3 bg-card">
          <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Mark as lost…</summary>
          <MarkLostForm id={opp.id} lostStageId={lostStage.id} />
        </details>
      ) : null}
    </section>
  );
}
