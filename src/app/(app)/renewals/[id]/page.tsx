import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrossSellPromptList } from "@/components/cross-sell/prompt-list";
import { RenewalOutcomeForm } from "@/components/renewals/outcome-form";
import { RenewalHistory } from "@/components/renewals/history";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { crossSellPrompts } from "@/lib/cross-sell/data";
import { addMonths, formatDateOnly, todayInZone } from "@/lib/dates";
import { getOpportunity } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { termLabel } from "@/lib/renewals";
import { outcomesFor } from "@/lib/renewals/data";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Renewal · The Bass Agency CRM" };

export default async function RenewalPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const opp = await getOpportunity(supabase, id);
  if (!opp) notFound();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const [contact, history, prompts] = await Promise.all([
    getContact(supabase, opp.contact_id),
    outcomesFor(supabase, opp.id),
    crossSellPrompts(supabase, today, { contactId: opp.contact_id }),
  ]);
  const name = contact ? contactDisplayName(contact) : "Contact";
  const active = opp.outcome === "won" && opp.policy_ended_on === null && opp.renewal_date !== null;
  const dismissNotice = query.dismissed ? "dismissed" : query.dismisserror ? "dismisserror" : undefined;

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/renewals" className="flex min-h-11 w-fit items-center text-sm underline">← Renewals</Link>
        <h1 className="text-2xl font-semibold break-words">Renewal · {name}</h1>
        <p>
          <Link href={`/opportunities/${opp.id}`} className="inline-flex min-h-11 items-center underline">{PRODUCT_LINE_NAMES[opp.product_line]} policy</Link>
          {opp.quoted_carrier ? ` · ${opp.quoted_carrier}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
        <div className="contents">
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Renewal date</dt>
          <dd>{formatDateOnly(opp.renewal_date) || "—"}{opp.renewal_date && opp.renewal_date < today && active ? " (passed)" : ""}</dd>
        </div>
        <div className="contents">
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Term</dt>
          <dd>{termLabel(opp.policy_term_months)}</dd>
        </div>
        <div className="contents">
          <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Est. annual premium</dt>
          <dd>{formatMoney(opp.estimated_annual_premium) || "—"}</dd>
        </div>
        {contact?.phone ? (
          <div className="contents">
            <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Phone</dt>
            <dd><a href={`tel:${contact.phone}`} className="inline-flex min-h-11 items-center underline">{contact.phone}</a></dd>
          </div>
        ) : null}
      </dl>

      {active ? (
        <section aria-labelledby="outcome-heading" className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <h2 id="outcome-heading" className="text-lg font-semibold">Record the outcome</h2>
          <RenewalOutcomeForm
            opportunityId={opp.id}
            nextRenewalLabel={`The next renewal will be ${formatDateOnly(addMonths(opp.renewal_date!, opp.policy_term_months))}, with a new review task.`}
          />
        </section>
      ) : (
        <p className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
          {opp.policy_ended_on
            ? `This policy ended on ${formatDateOnly(opp.policy_ended_on)}. Its history is kept below.`
            : opp.outcome !== "won"
              ? "Only a won opportunity (a client policy) has renewal outcomes."
              : "Add a renewal date to this policy to track its renewals."}
        </p>
      )}

      <CrossSellPromptList prompts={prompts} back={`/renewals/${opp.id}`} showContact={false} notice={dismissNotice} />
      <RenewalHistory outcomes={history} />
    </section>
  );
}
