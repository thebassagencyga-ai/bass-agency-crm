import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OutcomeBadge } from "@/components/opportunities/badges";
import { MarkLostForm, MoveStageForm } from "@/components/opportunities/stage-forms";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly, formatInstantDate } from "@/lib/dates";
import { getOpportunity, getStages, stagesFor } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { canToggleNurture } from "@/lib/opportunities/transitions";
import { LOSS_REASON_LABELS } from "@/lib/opportunities/types";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { setNurture } from "../actions";

export const metadata: Metadata = { title: "Opportunity · The Bass Agency CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Opportunity saved.", tone: "ok" },
  moved: { text: "Stage updated.", tone: "ok" },
  won: { text: "Marked as won.", tone: "ok" },
  lost: { text: "Marked as lost. The record is kept and can be reopened later.", tone: "ok" },
  reopened: { text: "Opportunity reopened. Its history is kept.", tone: "ok" },
  nurture: { text: "Moved to nurture.", tone: "ok" },
  unnurture: { text: "Back to open.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

export default async function OpportunityPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const opp = await getOpportunity(supabase, id);
  if (!opp) notFound();
  const [contact, allStages] = await Promise.all([getContact(supabase, opp.contact_id), getStages(supabase)]);
  const stages = stagesFor(allStages, opp.product_line);
  const stage = stages.find((s) => s.id === opp.stage_id);
  const lostStage = stages.find((s) => s.kind === "lost");
  const noticeKey = Object.keys(NOTICES).find((k) => query[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const name = contact ? contactDisplayName(contact) : "Contact";

  const rows: [string, React.ReactNode][] = [
    ["Contact", contact ? <Link href={`/contacts/${contact.id}`} className="underline">{name}</Link> : "—"],
    ["Product line", PRODUCT_LINE_NAMES[opp.product_line]],
    ["Stage", stage?.name ?? "—"],
    ["Description", opp.description ?? "—"],
    ["Next action", opp.next_action ?? "—"],
    ["Quoted carrier", opp.quoted_carrier ?? "—"],
    ["Quote sent", formatDateOnly(opp.quote_sent_on) || "—"],
    ["Est. annual premium", formatMoney(opp.estimated_annual_premium) || "—"],
    ["Effective date", formatDateOnly(opp.effective_date) || "—"],
    ["Renewal date", formatDateOnly(opp.renewal_date) || "—"],
    ...(opp.outcome === "lost" && opp.loss_reason
      ? [["Loss reason", [LOSS_REASON_LABELS[opp.loss_reason], opp.loss_reason_detail].filter(Boolean).join(" — ")] as [string, React.ReactNode]]
      : []),
    ...(opp.closed_at ? [["Closed", formatInstantDate(opp.closed_at)] as [string, React.ReactNode]] : []),
    ...(opp.cycle > 1 ? [["Times reopened", String(opp.cycle - 1)] as [string, React.ReactNode]] : []),
    ["Added", formatInstantDate(opp.created_at)],
    ["Last updated", formatInstantDate(opp.updated_at)],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Link href={`/opportunities?line=${opp.product_line}`} className="w-fit text-sm underline">← {PRODUCT_LINE_NAMES[opp.product_line]} pipeline</Link>
        <h1 className="text-2xl font-semibold break-words">{PRODUCT_LINE_NAMES[opp.product_line]} · {name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <OutcomeBadge outcome={opp.outcome} />
          <span className="text-sm text-slate-600 dark:text-slate-400">{stage?.name}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/opportunities/${opp.id}/edit`} className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Edit details</Link>
          {canToggleNurture(opp.outcome, opp.stage_kind) ? (
            <form action={setNurture}>
              <input type="hidden" name="id" value={opp.id} />
              <input type="hidden" name="nurture" value={opp.outcome === "nurture" ? "0" : "1"} />
              <button type="submit" className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">
                {opp.outcome === "nurture" ? "Back to open" : "Move to nurture"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="stage-heading" className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <h2 id="stage-heading" className="text-lg font-semibold">{opp.outcome === "won" || opp.outcome === "lost" ? "Reopen" : "Change stage"}</h2>
        <MoveStageForm id={opp.id} stages={stages} currentStageId={opp.stage_id} outcome={opp.outcome} />
      </section>

      {opp.outcome !== "lost" && lostStage ? (
        <details id="mark-lost" open={query.mark === "lost"} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Mark as lost…</summary>
          <MarkLostForm id={opp.id} lostStageId={lostStage.id} />
        </details>
      ) : null}
    </section>
  );
}
