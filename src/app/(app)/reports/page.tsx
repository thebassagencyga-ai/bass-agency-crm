import type { Metadata } from "next";
import Link from "next/link";
import { ReportTabs } from "@/components/reports/tabs";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import {
  DEFINITIONS, PERIODS, PERIOD_LABELS, formatConversion, num, parsePeriod, periodRange, premiumNote, sumBy,
} from "@/lib/reports";
import { getReport } from "@/lib/reports/data";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Reports · Producr CRM" };

const CHIP = "flex min-h-11 items-center rounded-md border px-3 text-sm font-medium";
const TABLE = "w-full min-w-0 border-collapse text-sm";
const TH = "border-b border-line py-2 pr-3 text-left font-medium text-muted";
const THN = `${TH} text-right`;
const TD = "border-b border-line py-2 pr-3 align-top";
const TDN = `${TD} text-right tabular-nums`;
const money = (v: number) => formatMoney(v, { whole: true });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const period = periodRange(parsePeriod(query), today);
  const r = await getReport(supabase, period, today);

  const closedWon = sumBy(r.conversion, (x) => x.won);
  const closedLost = sumBy(r.conversion, (x) => x.lost);
  const t = r.tasks;

  return (
    <section className="flex max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
      </div>
      <ReportTabs current="overview" />
      <p className="text-sm text-muted">
        {formatDateOnly(period.start)} – {formatDateOnly(period.end)} · New York time. Premiums are estimates you recorded; commission estimates are on the Production tab.
      </p>

      <nav aria-label="Report period" className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p} href={`/reports?period=${p}`} aria-current={period.key === p ? "page" : undefined}
            className={`${CHIP} ${period.key === p ? "border-brand bg-brand text-on-brand hover:bg-brand-hover" : "border-line-strong"}`}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </nav>

      <Report id="conversion" title="Conversion rate" definition={DEFINITIONS.conversion}>
        <p className="text-2xl font-bold tracking-tight">{formatConversion(closedWon, closedLost)}</p>
        {r.conversion.length === 0 ? null : (
          <Table caption="Conversion by product line" head={["Line", "Won", "Lost", "Conversion", "Won premium"]}>
            {r.conversion.map((x) => (
              <tr key={x.product_line}>
                <td className={TD}>{PRODUCT_LINE_NAMES[x.product_line]}</td>
                <td className={TDN}>{num(x.won)}</td>
                <td className={TDN}>{num(x.lost)}</td>
                <td className={TDN}>{formatConversion(num(x.won), num(x.lost))}</td>
                <td className={TDN}>{num(x.won) ? `${money(num(x.won_premium))}${premiumNote(num(x.won_with_premium), num(x.won))}` : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Report>

      <Report id="new-leads" title="New leads by source" definition={DEFINITIONS.new_leads}>
        {r.new_leads.length === 0 ? <Empty /> : (
          <Table caption="New leads by source" head={["Source", "Contacts", "With an opportunity", "Won"]}>
            {r.new_leads.map((x) => (
              <tr key={x.source ?? "(none)"}>
                <td className={TD}>{x.source ?? <span className="text-muted">Not recorded</span>}</td>
                <td className={TDN}>{num(x.contacts)}</td>
                <td className={TDN}>{num(x.with_opportunity)}</td>
                <td className={TDN}>{num(x.won)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Report>

      <Report id="quotes" title="Quotes sent and outcomes" definition={DEFINITIONS.quotes}>
        {r.quotes.length === 0 ? <Empty /> : (
          <Table caption="Quotes sent by product line" head={["Line", "Quoted", "Open", "Nurture", "Won", "Lost", "Est. premium"]}>
            {r.quotes.map((x) => (
              <tr key={x.product_line}>
                <td className={TD}>{PRODUCT_LINE_NAMES[x.product_line]}</td>
                <td className={TDN}>{num(x.quoted)}</td>
                <td className={TDN}>{num(x.open_count)}</td>
                <td className={TDN}>{num(x.nurture_count)}</td>
                <td className={TDN}>{num(x.won)}</td>
                <td className={TDN}>{num(x.lost)}</td>
                <td className={TDN}>{num(x.with_premium) ? `${money(num(x.premium))}${premiumNote(num(x.with_premium), num(x.quoted))}` : "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Report>

      <Report id="pipeline" title="Open opportunities by pipeline and stage" definition={DEFINITIONS.open_pipeline}>
        {r.open_pipeline.length === 0 ? <Empty text="No open opportunities." /> : (
          <Table caption="Open opportunities by pipeline and stage" head={["Pipeline", "Stage", "Open", "Nurture", "Est. premium"]}>
            {r.open_pipeline.map((x) => (
              <tr key={`${x.pipeline_id}-${x.stage_position}-${x.stage_name}`}>
                <td className={TD}>{x.pipeline_name}</td>
                <td className={TD}>{x.stage_name}</td>
                <td className={TDN}>{num(x.open_count)}</td>
                <td className={TDN}>{num(x.nurture_count)}</td>
                <td className={TDN}>
                  {num(x.with_premium) ? `${money(num(x.premium))}${premiumNote(num(x.with_premium), num(x.open_count) + num(x.nurture_count))}` : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Report>

      <Report id="tasks-report" title="Tasks completed vs overdue" definition={DEFINITIONS.tasks}>
        <Stats
          label="Task figures"
          items={[
            ["Completed", num(t.completed)],
            ["On time", num(t.completed_on_time)],
            ["Late", num(t.completed_late)],
            ["Overdue now", num(t.overdue_now)],
          ]}
        />
      </Report>

      <Report id="renewals-report" title="Upcoming renewal reviews" definition={DEFINITIONS.renewals}>
        <Stats
          label="Renewal review figures"
          items={[
            ["Reviews overdue", num(r.renewals.reviews_overdue)],
            ["Reviews due in 30 days", num(r.renewals.reviews_next_30)],
            ["Reviews due in 31–60 days", num(r.renewals.reviews_31_60)],
            ["Policies renewing in 90 days", num(r.renewals.policies_next_90)],
          ]}
        />
        <p className="text-sm">
          Outcomes recorded in the period: {num(r.renewals.outcomes.renewed)} renewed, {num(r.renewals.outcomes.remarketed)} re-marketed,{" "}
          {num(r.renewals.outcomes.lost)} lost.
        </p>
      </Report>

      <Report id="cross-sell-report" title="Cross-sell opportunities" definition={DEFINITIONS.cross_sell}>
        {r.cross_sell.by_rule.length === 0 ? <Empty text="No cross-sell reviews showing." /> : (
          <Table caption="Cross-sell reviews by rule" head={["Rule", "Suggests", "Clients"]}>
            {r.cross_sell.by_rule.map((x) => (
              <tr key={x.rule_name}>
                <td className={TD}>{x.rule_name}</td>
                <td className={TD}>{PRODUCT_LINE_NAMES[x.lacks_line]}</td>
                <td className={TDN}>{num(x.prompts)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-sm">Dismissed in the period: {num(r.cross_sell.dismissed)}</p>
      </Report>

      <Report id="referrals-report" title="Referral sources" definition={DEFINITIONS.referrals}>
        {r.referrals.length === 0 ? <Empty text="No referred contacts added in this period." /> : (
          <Table caption="Referral sources" head={["Referred by", "Referred", "Won", "Working"]}>
            {r.referrals.map((x) => (
              <tr key={x.referrer_id}>
                <td className={TD}><Link href={`/contacts/${x.referrer_id}`} className="inline-flex min-h-11 min-w-11 items-center underline text-link">{contactDisplayName(x)}</Link></td>
                <td className={TDN}>{num(x.referred)}</td>
                <td className={TDN}>{num(x.won)}</td>
                <td className={TDN}>{num(x.working)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Report>

      <Report id="asks-report" title="Review and referral requests" definition={DEFINITIONS.asks}>
        <Stats
          label="Review and referral figures"
          items={[
            ["Clients asked for a review", num(r.asks.review_asked)],
            ["Reviews recorded", num(r.asks.reviews_recorded)],
            ["Clients asked for a referral", num(r.asks.referral_asked)],
            ["Referrals received", num(r.asks.referrals_received)],
          ]}
        />
      </Report>
    </section>
  );
}

function Report({ id, title, definition, children }: { id: string; title: string; definition: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">{title}</h2>
      {children}
      <p className="text-xs text-muted"><span className="font-medium">How it&apos;s counted:</span> {definition}</p>
    </section>
  );
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head.map((h, i) => <th key={h} scope="col" className={i === 0 || h === "Stage" || h === "Suggests" ? TH : THN}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Stats({ label, items }: { label: string; items: [string, number][] }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([name, value]) => (
        <div key={name} className="flex flex-col rounded-md border border-line p-3 bg-card">
          <dt className="order-2 text-sm text-muted">{name}</dt>
          <dd className="order-1 text-2xl font-bold tracking-tight tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ text = "Nothing in this period." }: { text?: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}
