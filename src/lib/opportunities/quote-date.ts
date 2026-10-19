// Quote date when an opportunity moves into a quote stage (Phase 23, ADR-039). Pure; unit
// tested. The database records today's date on any path that leaves it empty; these helpers
// decide what the stage form suggests and what it saves.
import { isIsoDate } from "@/lib/dates";

/**
 * Suggested quote date: keep a date already recorded for this round, but a reopened (won or
 * lost) opportunity is a new round, so it starts from today.
 */
export function suggestedQuoteDate(input: { existing: string | null; reopening: boolean; today: string }): string {
  return input.existing && !input.reopening ? input.existing : input.today;
}

export type QuoteDateResult = { ok: true; date: string } | { ok: false; message: string };

/** The date to save: what the agent entered (not in the future), or the suggestion if blank. */
export function resolveQuoteDate(submitted: string | null | undefined, suggestion: string, today: string): QuoteDateResult {
  const value = (submitted ?? "").trim();
  if (!value) return { ok: true, date: suggestion };
  if (!isIsoDate(value)) return { ok: false, message: "Enter a valid date." };
  if (value > today) return { ok: false, message: "The quote date cannot be in the future." };
  return { ok: true, date: value };
}
