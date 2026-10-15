// Report periods (Phase 9, ADR-024). Calendar dates in the user's time zone; a period that
// includes today ends today (never in the future).
import { addDays, addMonths } from "@/lib/dates";

export const PERIODS = ["this_month", "last_month", "this_quarter", "year_to_date", "last_12_months"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABELS: Readonly<Record<PeriodKey, string>> = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  year_to_date: "Year to date",
  last_12_months: "Last 12 months",
};

export interface Period {
  key: PeriodKey;
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Start and end dates (inclusive) of a period, given today's date (YYYY-MM-DD). */
export function periodRange(key: PeriodKey, today: string): Period {
  const [y, m] = today.split("-").map(Number) as [number, number, number];
  const monthStart = `${y}-${pad(m)}-01`;
  switch (key) {
    case "this_month":
      return { key, start: monthStart, end: today };
    case "last_month": {
      const start = addMonths(monthStart, -1);
      return { key, start, end: addDays(monthStart, -1) };
    }
    case "this_quarter":
      return { key, start: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, end: today };
    case "year_to_date":
      return { key, start: `${y}-01-01`, end: today };
    case "last_12_months":
      return { key, start: addDays(addMonths(today, -12), 1), end: today };
  }
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads ?period=… (default: this month). */
export function parsePeriod(query: Record<string, string | string[] | undefined>): PeriodKey {
  const p = first(query.period);
  return (PERIODS as readonly string[]).includes(p ?? "") ? (p as PeriodKey) : "this_month";
}
