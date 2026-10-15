import type { RenewalRow } from "./types";

export interface RenewalGroups {
  /** Active policies whose renewal date has passed with no outcome recorded yet. */
  pastDue: RenewalRow[];
  /** Active policies renewing from today on. */
  policies: RenewalRow[];
  /** Prospects' current policies (open or nurture opportunities): timing for a quote. */
  prospects: RenewalRow[];
}

/** Splits search_renewals rows for the Renewals page. Order within each group is kept. */
export function groupRenewals(rows: readonly RenewalRow[], today: string): RenewalGroups {
  const groups: RenewalGroups = { pastDue: [], policies: [], prospects: [] };
  for (const row of rows) {
    if (row.outcome !== "won") groups.prospects.push(row);
    else if (row.renewal_date < today) groups.pastDue.push(row);
    else groups.policies.push(row);
  }
  return groups;
}

/** "Renews every 6 months" / "Renews yearly". */
export function termLabel(months: number): string {
  return months === 6 ? "Renews every 6 months" : "Renews yearly";
}
