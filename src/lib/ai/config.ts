// AI helpers (Phase 19, ADR-035): configuration. The helpers are OFF unless the server has an
// ANTHROPIC_API_KEY (set only in the hosting provider's secret store, never NEXT_PUBLIC_).

export const AI_MODEL = "claude-opus-5-5";

/**
 * Prices used for the budget, in USD per million tokens. Deliberately the higher of the model's
 * own price ($4 / $20) and its possible refusal fallback's ($5 / $25), so the cap is never
 * under-counted.
 */
export const BUDGET_PRICE = { inputPerMTok: 5, outputPerMTok: 25 } as const;

/** The owner's cap (CLAUDE.md, ADR-030): $10 a month. AI_MONTHLY_BUDGET_USD may only lower it. */
export const MAX_MONTHLY_BUDGET_USD = 10;

export function monthlyBudgetUsd(raw: string | undefined = process.env.AI_MONTHLY_BUDGET_USD): number {
  const n = raw === undefined || raw.trim() === "" ? MAX_MONTHLY_BUDGET_USD : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_MONTHLY_BUDGET_USD);
}

export function aiEnabled(key: string | undefined = process.env.ANTHROPIC_API_KEY): boolean {
  return typeof key === "string" && key.trim().length > 20;
}
