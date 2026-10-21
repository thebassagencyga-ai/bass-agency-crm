import type { Metadata } from "next";
import Link from "next/link";
import { ReportTabs } from "@/components/reports/tabs";
import { requireFullSession } from "@/lib/auth/require";
import { todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES, linesToShow } from "@/lib/pipelines";
import {
  forecastTotal, goalPercent, monthChoices, monthCommission, monthLabel, monthShort, n, parseMonth, yearPace,
} from "@/lib/production";
import { getProduction } from "@/lib/production/data";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Production · Producr CRM" };

// Reports → Production (Phase 28, ADR-046): written premium and policies against goals, expected
// commission (estimates from the agent's own rates) and the next 12 months. One database call.

const TABLE = "w-full min-w-0 border-collapse text-sm";
const TH = "border-b border-line py-2 pr-3 text-left font-medium text-muted whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "border-b border-line py-2 pr-3 align-top whitespace-nowrap";
const TDN = `${TD} text-right tabular-nums`;
const money = (v: number) => formatMoney(v, { whole: true });
const pct = (v: number | string | null) => (v === null || v === undefined || v === "" ? "—" : `${Number(v)}%`);

function Progress({ percent, label }: { percent: number | null; label: string }) {
  if (percent === null) return null;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label={label}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

function Stat({ title, value, children }: { title: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-card p-4 shadow-sm">
      <p className="text-sm font-medium text-muted">{title}</p>
      <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {children}
    </div>
  );
}

export default async function ProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const today = todayInZone((await getProfile(supabase, userId)).time_zone);
  const month = parseMonth(query.month, today);
  const r = await getProduction(supabase, month);
  const label = monthLabel(month);
  const premium = n(r.written.premium);
  const ytd = n(r.ytd.premium);
  const goals = r.goals;
  const commission = monthCommission(r);
  // Phase 30: a line other than the four main ones gets a row once it has a sale, renewal or rate.
  const shownLines = linesToShow((line) => {
    const l = r.by_line.find((x) => x.product_line === line);
    return !!l && (l.policies > 0 || (l.renewals ?? 0) > 0 || l.new_rate !== null || l.renewal_rate !== null);
  });
  const premiumPct = goalPercent(premium, goals?.premium_per_month);
  const policiesPct = goalPercent(r.written.policies, goals?.policies_per_month);
  const yearPct = goalPercent(ytd, goals?.premium_per_year);
  const maxForecast = Math.max(1, ...r.forecast.map(forecastTotal));
  const perPolicy = r.active_policies > 0 ? commission.total / r.active_policies : 0;

  return (
    <section className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <form method="get" action="/reports/production" className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="month" className="text-sm font-medium">Month</label>
            <select id="month" name="month" defaultValue={month.slice(0, 7)} className="min-h-11 rounded-md border border-line-strong bg-card px-3 text-base text-fg">
              {monthChoices(today).map((m) => <option key={m} value={m.slice(0, 7)}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card px-4 font-medium hover:bg-subtle">Show</button>
        </form>
      </div>
      <ReportTabs current="production" />
      <p className="text-sm text-muted">
        Built from the policies you bind in Producr and your rates in <Link href="/settings/production" className="underline text-link">Settings → Commission and goals</Link>.
        Commission is an estimate; your carrier statements are the final word. New York time.
      </p>

      {!r.rates_set ? (
        <p role="status" className="rounded-md bg-caution-soft p-3 text-sm text-caution">
          Add your commission rates in <Link href="/settings/production" className="underline">Settings → Commission and goals</Link> to see expected commission. Until then it shows $0.
        </p>
      ) : null}

      <section aria-label={`${label} at a glance`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title={`Premium written · ${monthShort(month)}`} value={money(premium)}>
          <Progress percent={premiumPct} label={`${premiumPct ?? 0} percent of the monthly premium goal`} />
          <p className="text-sm text-muted">
            {premiumPct === null ? "No monthly goal set" : `${premiumPct}% of your ${money(n(goals?.premium_per_month))} goal`}
            {r.written.without_premium > 0 ? ` · ${r.written.without_premium} without a premium` : ""}
          </p>
        </Stat>
        <Stat title={`Policies written · ${monthShort(month)}`} value={String(r.written.policies)}>
          <Progress percent={policiesPct} label={`${policiesPct ?? 0} percent of the monthly policy goal`} />
          <p className="text-sm text-muted">{policiesPct === null ? "No monthly goal set" : `Goal ${goals?.policies_per_month}`}</p>
        </Stat>
        <Stat title={`Expected commission · ${monthShort(month)}`} value={money(commission.total)}>
          <p className="text-sm text-muted">{money(commission.newBusiness)} new business · {money(commission.renewals)} renewals</p>
        </Stat>
        <Stat title={`Premium written · ${month.slice(0, 4)} to date`} value={money(ytd)}>
          <Progress percent={yearPct} label={`${yearPct ?? 0} percent of the yearly premium goal`} />
          <p className="text-sm text-muted">
            {yearPct === null ? "No yearly goal set" : `${yearPct}% of ${money(n(goals?.premium_per_year))}`} · on pace for {money(yearPace(ytd, month))}
          </p>
        </Stat>
      </section>

      <section aria-labelledby="by-line" className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4">
        <h2 id="by-line" className="text-lg font-semibold">{label} by line</h2>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Production and expected commission by line, {label}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Line</th><th scope="col" className={THN}>Policies</th><th scope="col" className={THN}>Premium written</th>
                <th scope="col" className={THN}>New-business rate</th><th scope="col" className={THN}>Commission (new)</th>
                <th scope="col" className={THN}>Renewals due</th><th scope="col" className={THN}>Commission (renewal)</th>
              </tr>
            </thead>
            <tbody>
              {r.by_line.filter((l) => shownLines.includes(l.product_line)).map((l) => (
                <tr key={l.product_line}>
                  <th scope="row" className={`${TD} font-medium`}>{PRODUCT_LINE_NAMES[l.product_line]}</th>
                  <td className={TDN}>{l.policies}</td>
                  <td className={TDN}>{money(n(l.premium))}</td>
                  <td className={TDN}>{l.product_line === "life" ? "by type" : pct(l.new_rate)}</td>
                  <td className={TDN}>{money(n(l.commission_new))}</td>
                  <td className={TDN}>{l.product_line === "life" ? "—" : `${l.renewals ?? 0} · ${money(n(l.renewal_premium))}`}</td>
                  <td className={TDN}>{money(n(l.commission_renewal))}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className={`${TD} font-bold`}>Total</th>
                <td className={`${TDN} font-bold`}>{r.written.policies}</td>
                <td className={`${TDN} font-bold`}>{money(premium)}</td>
                <td className={TDN} />
                <td className={`${TDN} font-bold`}>{money(commission.newBusiness)}</td>
                <td className={TDN} />
                <td className={`${TDN} font-bold`}>{money(commission.renewals)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          Every line except life: new business in the month bound, renewals in their renewal month. Life is paid in step with the premium mode: the
          first-year rate for 12 months, then the renewal rate.
          {r.life_without_type > 0 ? ` ${r.life_without_type} life ${r.life_without_type === 1 ? "policy has" : "policies have"} no policy type or rate yet, so ${r.life_without_type === 1 ? "it shows" : "they show"} $0.` : ""}
        </p>
      </section>

      <section aria-labelledby="ahead" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ahead" className="text-lg font-semibold">Expected commission, next 12 months</h2>
          <p className="text-sm text-muted">From policies already on the books. New sales are not guessed.</p>
        </div>
        <ol aria-label="Expected commission by month" className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {r.forecast.map((f, i) => {
            const v = forecastTotal(f);
            return (
              <li key={f.month} className="flex flex-col items-center gap-1">
                <span className="text-xs tabular-nums text-muted">{money(v)}</span>
                <div className="flex h-28 w-full items-end justify-center" aria-hidden="true">
                  <div className={`w-full max-w-11 rounded-t ${i === 0 ? "bg-fg" : "bg-brand"}`} style={{ height: `${Math.max(2, Math.round((v / maxForecast) * 112))}px` }} />
                </div>
                <span className={`text-xs ${i === 0 ? "font-bold" : "text-muted"}`}>{monthShort(f.month)}</span>
                <span className="sr-only">{monthLabel(f.month)}: {money(v)}</span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-3 text-sm text-muted">
          <span><strong className="text-fg">{r.active_policies}</strong> active policies</span>
          <span><strong className="text-fg">{formatMoney(perPolicy)}</strong> expected commission per active policy this month</span>
          <span><strong className="text-fg">{r.ended_this_month}</strong> ended this month (no longer forecast)</span>
          <a href={`/reports/production/csv?month=${month.slice(0, 7)}`} download className="flex min-h-11 items-center rounded-md border border-line-strong bg-card px-4 font-medium text-fg hover:bg-subtle sm:ml-auto">Download as CSV</a>
        </div>
      </section>
    </section>
  );
}
