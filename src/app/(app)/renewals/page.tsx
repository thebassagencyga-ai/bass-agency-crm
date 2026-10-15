import type { Metadata } from "next";
import Link from "next/link";
import { CrossSellPromptList } from "@/components/cross-sell/prompt-list";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import { crossSellPrompts } from "@/lib/cross-sell/data";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { RENEWAL_WINDOWS, groupRenewals, parseRenewalParams, renewalsHref, termLabel, type RenewalRow } from "@/lib/renewals";
import { searchRenewals } from "@/lib/renewals/data";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Renewals · The Bass Agency CRM" };

const RECORDED: Record<string, string> = {
  kept: "Renewal recorded. The renewal date moved to the next term and its review task was added.",
  lost: "Recorded as lost. The policy no longer appears in renewals; its history is kept.",
  lostformer: "Recorded as lost. The policy no longer appears in renewals, and the contact is now a former client (no other active policy).",
};

const CHIP = "flex min-h-11 items-center rounded-md border px-3 text-sm font-medium";
const chipClass = (active: boolean) =>
  `${CHIP} ${active ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-600"}`;

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const params = parseRenewalParams(query);
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const [rows, prompts] = await Promise.all([searchRenewals(supabase, params, today), crossSellPrompts(supabase, today)]);
  const groups = groupRenewals(rows, today);
  const recorded = query.recorded ? RECORDED[query.recorded] : undefined;
  const dismissNotice = query.dismissed ? "dismissed" : query.dismisserror ? "dismisserror" : undefined;

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      {recorded ? <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{recorded}</p> : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Renewals</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Review each client policy before it renews, then record what happened.</p>
      </div>

      <nav aria-label="Renewal window" className="flex flex-wrap gap-2">
        {RENEWAL_WINDOWS.map((d) => (
          <Link key={d} href={renewalsHref(params, { days: d })} aria-current={params.days === d ? "page" : undefined} className={chipClass(params.days === d)}>
            Next {d} days
          </Link>
        ))}
      </nav>
      <nav aria-label="Product line" className="flex flex-wrap gap-2">
        <Link href={renewalsHref(params, { line: null })} aria-current={params.line === null ? "page" : undefined} className={chipClass(params.line === null)}>All lines</Link>
        {PRODUCT_LINES.map((l) => (
          <Link key={l} href={renewalsHref(params, { line: l })} aria-current={params.line === l ? "page" : undefined} className={chipClass(params.line === l)}>
            {PRODUCT_LINE_NAMES[l]}
          </Link>
        ))}
      </nav>

      {groups.pastDue.length > 0 ? (
        <RenewalList
          id="past-due" title="Past renewal date" danger rows={groups.pastDue}
          intro="These renewal dates have passed. Record what happened so the next renewal is tracked."
          empty=""
        />
      ) : null}
      <RenewalList
        id="policies" title="Client policies" rows={groups.policies}
        empty={`No client policies renew in the next ${params.days} days.`}
      />
      <RenewalList
        id="prospects" title="Prospects' current policies" rows={groups.prospects} prospect
        intro="Renewal dates of policies your prospects have elsewhere: a good time to quote."
        empty={`No prospect renewal dates in the next ${params.days} days.`}
      />

      <CrossSellPromptList prompts={prompts} back={renewalsHref(params)} showContact notice={dismissNotice} />
    </section>
  );
}

function RenewalList({
  id, title, rows, empty, intro, danger = false, prospect = false,
}: { id: string; title: string; rows: RenewalRow[]; empty: string; intro?: string; danger?: boolean; prospect?: boolean }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <h2 id={`${id}-heading`} className={`text-lg font-semibold ${danger ? "text-red-800 dark:text-red-300" : ""}`}>
        {title} <span className="text-sm font-normal text-slate-600 dark:text-slate-400">({rows.length})</span>
      </h2>
      {intro ? <p className="text-sm text-slate-600 dark:text-slate-400">{intro}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{empty}</p>
      ) : (
        <ul aria-label={title} className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col">
                <Link href={`/contacts/${r.contact_id}`} className="font-medium break-words underline-offset-2 hover:underline">
                  {contactDisplayName(r)} · {PRODUCT_LINE_NAMES[r.product_line]}
                </Link>
                <span className="text-sm">Renews {formatDateOnly(r.renewal_date)}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {[
                    prospect ? r.quoted_carrier && `Quoted ${r.quoted_carrier}` : termLabel(r.policy_term_months),
                    formatMoney(r.estimated_annual_premium, { whole: true }) && `${formatMoney(r.estimated_annual_premium, { whole: true })}/yr`,
                    !prospect && r.review_due_date ? `Review task due ${formatDateOnly(r.review_due_date)}` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
              <Link
                href={prospect ? `/opportunities/${r.id}` : `/renewals/${r.id}`}
                className={`flex min-h-11 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium ${prospect ? "border border-slate-900 dark:border-slate-100" : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"}`}
              >
                {prospect ? "Open opportunity" : "Record outcome"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
