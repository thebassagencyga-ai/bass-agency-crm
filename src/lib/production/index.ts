// Production and commission (Phase 28, ADR-046): the shape production_report returns, labels,
// form validation and the small date/money maths shown on the pages. Pure functions; the
// commission rules themselves are worked out in the database (…_production.sql).
import { z } from "zod";
import { addMonths, isIsoDate } from "@/lib/dates";
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";

export const LIFE_POLICY_TYPES = ["term", "whole", "universal", "indexed_universal", "final_expense"] as const;
export type LifePolicyType = (typeof LIFE_POLICY_TYPES)[number];
export const LIFE_POLICY_TYPE_LABELS: Readonly<Record<LifePolicyType, string>> = {
  term: "Term Life",
  whole: "Whole Life",
  universal: "Universal Life",
  indexed_universal: "Indexed Universal Life",
  final_expense: "Final Expense",
};

export const PREMIUM_MODES = ["monthly", "quarterly", "semiannual", "annual"] as const;
export type PremiumMode = (typeof PREMIUM_MODES)[number];
export const PREMIUM_MODE_LABELS: Readonly<Record<PremiumMode, string>> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Yearly",
};
export const PAYMENTS_PER_YEAR: Readonly<Record<PremiumMode, number>> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

/** Lines with one rate pair each (life has one per policy type). Phase 30: every line but life. */
export const PC_LINES = PRODUCT_LINES.filter((l): l is Exclude<ProductLine, "life"> => l !== "life");

export interface ProductionLine {
  product_line: ProductLine;
  policies: number;
  premium: number | string;
  new_rate: number | string | null;
  commission_new: number | string;
  renewals: number | null;
  renewal_premium: number | string | null;
  renewal_rate: number | string | null;
  commission_renewal: number | string;
}

export interface ProductionReport {
  month: string;
  rates_set: boolean;
  goals: { premium_per_month: number | string | null; policies_per_month: number | null; premium_per_year: number | string | null } | null;
  written: { policies: number; premium: number | string; without_premium: number };
  ytd: { policies: number; premium: number | string };
  by_line: ProductionLine[];
  forecast: { month: string; renewals: number | string; life: number | string; new_business: number | string }[];
  active_policies: number;
  ended_this_month: number;
  life_without_type: number;
}

/** Postgres numerics arrive as strings through the Data API. */
export const n = (v: number | string | null | undefined): number => (v === null || v === undefined || v === "" ? 0 : Number(v));

export const forecastTotal = (f: ProductionReport["forecast"][number]) => n(f.renewals) + n(f.life) + n(f.new_business);

/** Commission expected in the report's month: new business, renewals and life instalments. */
export function monthCommission(r: ProductionReport): { newBusiness: number; renewals: number; total: number } {
  const newBusiness = r.by_line.reduce((s, l) => s + n(l.commission_new), 0);
  const renewals = r.by_line.reduce((s, l) => s + n(l.commission_renewal), 0);
  return { newBusiness, renewals, total: newBusiness + renewals };
}

/** Whole percent of a goal reached, capped at 100 for the bar; null without a goal. */
export function goalPercent(value: number, goal: number | string | null | undefined): number | null {
  const g = n(goal);
  if (g <= 0) return null;
  return Math.round((value / g) * 100);
}

/** Year-end pace: year to date ÷ months so far (including this one) × 12. */
export function yearPace(ytdPremium: number, month: string): number {
  const monthNumber = Number(month.slice(5, 7));
  return monthNumber > 0 ? Math.round((ytdPremium / monthNumber) * 12) : 0;
}

/** "2026-10-01" for ?month=2026-10, else this month (from today in the user's zone). */
export function parseMonth(raw: string | undefined, today: string): string {
  if (raw && /^\d{4}-\d{2}$/.test(raw) && isIsoDate(`${raw}-01`) && raw >= "2000-01" && raw <= "2099-12") return `${raw}-01`;
  return `${today.slice(0, 7)}-01`;
}

/** The months offered in the picker: this month and the 23 before it, newest first. */
export function monthChoices(today: string): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: 24 }, (_, i) => addMonths(first, -i));
}

export const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));
export const monthShort = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The deal page's preview, same rules as the database: premium ÷ payments per year × rate,
 * from the first payout month (else the effective date). Null when something is missing.
 */
export function lifeInstalment(input: { premium: number | null; mode: PremiumMode | null; rate: number | null; firstPayoutOn: string | null; effectiveDate: string | null }):
  { amount: number; perYear: number; fromMonth: string | null } | null {
  if (input.premium === null || input.premium <= 0 || input.rate === null) return null;
  const perYear = PAYMENTS_PER_YEAR[input.mode ?? "monthly"];
  const start = input.firstPayoutOn ?? input.effectiveDate;
  return {
    amount: Math.round((input.premium / perYear) * (input.rate / 100) * 100) / 100,
    perYear,
    fromMonth: start && isIsoDate(start) ? `${start.slice(0, 7)}-01` : null,
  };
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const blankToNull = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null);

/** A percent 0–100 with up to two decimals, or empty. "45", "45%", "12.5" are accepted. */
export const rateField = z.preprocess(
  (v) => {
    const s = blankToNull(v);
    if (s === null || typeof s !== "string") return s;
    const t = s.replace(/%$/, "").trim();
    return t === "" ? null : Number(t);
  },
  z.number({ message: "Enter a percent like 15 or 12.5." })
    .refine((x) => Number.isFinite(x), "Enter a percent like 15 or 12.5.")
    .min(0, "Use 0 to 100.").max(100, "Use 0 to 100.")
    .refine((x) => Math.round(x * 100) === x * 100, "Use at most two decimals.")
    .nullable(),
);

const moneyField = z.preprocess(
  (v) => {
    const s = blankToNull(v);
    if (s === null || typeof s !== "string") return s;
    return Number(s.replace(/[$,\s]/g, ""));
  },
  z.number({ message: "Enter an amount like 20,000." }).refine((x) => Number.isFinite(x), "Enter an amount like 20,000.")
    .min(0, "Use 0 or more.").max(9_999_999_999, "That amount is too large.").nullable(),
);

export const goalsSchema = z.object({
  premium_per_month: moneyField,
  policies_per_month: z.preprocess(
    (v) => { const s = blankToNull(v); return s === null || typeof s !== "string" ? s : Number(s.replace(/,/g, "")); },
    z.number({ message: "Enter a whole number." }).int("Enter a whole number.").min(0, "Use 0 or more.").max(10000, "Use 10,000 or fewer.").nullable(),
  ),
  premium_per_year: moneyField,
});

/** Field names on the rates form: rate_<line>_new / rate_<line>_renewal, life: rate_life_<type>_…. */
export const rateKey = (line: string, type: LifePolicyType | null, kind: "new" | "renewal") =>
  `rate_${line}${type ? `_${type}` : ""}_${kind}`;

export const RATE_ROWS: readonly { line: ProductLine; type: LifePolicyType | null }[] = [
  ...PC_LINES.map((line) => ({ line, type: null })),
  ...LIFE_POLICY_TYPES.map((type) => ({ line: "life" as const, type })),
];

export const lifeDetailsSchema = z.object({
  id: z.uuid(),
  life_policy_type: z.preprocess(blankToNull, z.enum(LIFE_POLICY_TYPES, { message: "Choose a policy type." }).nullable()),
  premium_mode: z.preprocess(blankToNull, z.enum(PREMIUM_MODES, { message: "Choose how often premium is paid." }).nullable()),
  first_payout_on: z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable()),
  commission_rate_override: rateField,
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const PRODUCTION_CSV_COLUMNS = [
  { key: "section", label: "Section" },
  { key: "item", label: "Item" },
  { key: "policies", label: "Policies" },
  { key: "premium", label: "Premium" },
  { key: "commission", label: "Expected commission" },
] as const;

/** The report as spreadsheet rows: the month by line, then the next 12 months. */
export function productionCsvRows(r: ProductionReport, lineName: (l: ProductLine) => string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const l of r.by_line) {
    rows.push({ section: `${monthLabel(r.month)} new business`, item: lineName(l.product_line), policies: l.policies, premium: n(l.premium), commission: n(l.commission_new) });
    if (l.product_line === "life") {
      rows.push({ section: `${monthLabel(r.month)} renewal years`, item: lineName(l.product_line), policies: "", premium: "", commission: n(l.commission_renewal) });
    } else {
      rows.push({ section: `${monthLabel(r.month)} renewals`, item: lineName(l.product_line), policies: l.renewals ?? 0, premium: n(l.renewal_premium), commission: n(l.commission_renewal) });
    }
  }
  for (const f of r.forecast) {
    rows.push({ section: "Next 12 months", item: monthLabel(f.month), policies: "", premium: "", commission: Math.round(forecastTotal(f) * 100) / 100 });
  }
  return rows;
}
