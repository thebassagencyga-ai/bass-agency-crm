// Monthly spending cap for the AI helpers (Phase 19, ADR-035). Pure; unit tested.
import { DEFAULT_TIME_ZONE, todayInZone, zonedLocalToIso } from "@/lib/dates";
import { BUDGET_PRICE } from "./config";

/** Cost of a call, rounded up to a millionth of a dollar. */
export function costUsd(inputTokens: number, outputTokens: number): number {
  const raw = (inputTokens * BUDGET_PRICE.inputPerMTok + outputTokens * BUDGET_PRICE.outputPerMTok) / 1_000_000;
  return Math.ceil(raw * 1_000_000) / 1_000_000;
}

/** The most a call can cost: input estimated generously (1 token per 3 characters + overhead), every output token used. */
export function worstCaseUsd(promptChars: number, maxTokens: number): number {
  return costUsd(Math.ceil(promptChars / 3) + 500, maxTokens);
}

/** Start of the current calendar month in the user's time zone, as an instant (ISO, UTC). */
export function monthStart(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  const first = `${todayInZone(timeZone, now).slice(0, 7)}-01T00:00`;
  return zonedLocalToIso(first, timeZone) ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export type BudgetCheck = { ok: true } | { ok: false; reason: "off" | "spent" };

export function checkBudget(spentThisMonth: number, worstCase: number, cap: number): BudgetCheck {
  if (cap <= 0) return { ok: false, reason: "off" };
  return spentThisMonth + worstCase <= cap ? { ok: true } : { ok: false, reason: "spent" };
}
