// Small calculations and the written definitions shown on the Reports page.

/** Conversion = won ÷ (won + lost). Null when nothing closed (no denominator). */
export function conversionRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

/** "50% (1 of 2 closed)" or "— (none closed)". Whole percent, rounded half up. */
export function formatConversion(won: number, lost: number): string {
  const rate = conversionRate(won, lost);
  if (rate === null) return "— (none closed)";
  return `${Math.round(rate * 100)}% (${won} of ${won + lost} closed)`;
}

/** Postgres numeric and bigint can arrive as strings through the Data API. */
export const num = (v: number | string | null | undefined): number => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function sumBy<T>(rows: readonly T[], pick: (row: T) => number | string | null | undefined): number {
  return rows.reduce((total, row) => total + num(pick(row)), 0);
}

/** "$2,000/yr est. (2 of 3 with a premium)": premiums are only ever totals of recorded values. */
export function premiumNote(withPremium: number, of: number): string {
  if (of === 0) return "";
  return withPremium === of ? "" : ` (${withPremium} of ${of} have a premium recorded)`;
}

export const DEFINITIONS = {
  open_pipeline:
    "Open and nurture opportunities right now, by product line and stage (not limited to the period). Estimated premium is the total of the premiums recorded; opportunities without one add nothing.",
  new_leads:
    "Contacts added during the period (New York dates), grouped by lead source (capital letters and spaces ignored). \"With an opportunity\" and \"Won\" count those contacts that have any opportunity, or a won one, as of today. Imported clients and clients added with a policy they already had are not counted.",
  quotes:
    "Opportunities whose quote-sent date is in the period, by product line, and where each stands today (open, nurture, won or lost). Premium is the total of the estimates recorded.",
  conversion:
    "Opportunities closed during the period: conversion = won ÷ (won + lost). Open and nurture opportunities are not counted. The number closed (the denominator) is shown next to each rate. A reopened opportunity counts by its latest close. Imported policies and policies added as already held are not sales and are not counted.",
  tasks:
    "Tasks completed during the period; on time means completed on or before the due date (New York dates). Overdue is open tasks due before today, whatever the period.",
  renewals:
    "Open renewal-review tasks by due date (today onward, or overdue), client policies (won and not ended) renewing in the next 90 days, and renewal outcomes recorded during the period.",
  cross_sell:
    "Cross-sell review prompts showing today, by rule (the same list as on Renewals; dismissed prompts excluded), and prompts dismissed during the period.",
  referrals:
    "Contacts added during the period who were referred by another contact, grouped by who referred them. Won: the referred contact has a won opportunity. Working: an open or nurture one and none won. Top 25 referrers. Imported clients and clients added with a policy they already had are not counted.",
  asks:
    "Clients asked for a Google review or a referral during the period (a completed request task or a logged request activity; each client counted once), reviews recorded (the \"Google review left on\" date is in the period), and referrals received (contacts added during the period with a referrer, not imported or added with a policy they already had).",
} as const;
