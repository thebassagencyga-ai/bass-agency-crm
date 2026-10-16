import { addDays } from "@/lib/dates";
import { MONTH_NAMES, INTAKE_LINE_LABELS, type CoverageEntry } from "./types";

/** First day of `month` on or after today's month (mirrors crm_engine.next_month_start). */
export function nextMonthStart(month: number, today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const year = month >= m ? y : y + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** When the quote task is due: 30 days before the renewal, but never before today. */
export function quoteDueDate(renewsOn: string, today: string): string {
  const due = addDays(renewsOn, -30);
  return due < today ? today : due;
}

/** "Auto: Example Mutual, renews in March" */
export function describeCoverage(c: CoverageEntry): string {
  const parts = [c.carrier, c.renews_month ? `renews in ${MONTH_NAMES[c.renews_month - 1]}` : null].filter(Boolean);
  return `${INTAKE_LINE_LABELS[c.line]}: ${parts.join(", ")}`;
}
