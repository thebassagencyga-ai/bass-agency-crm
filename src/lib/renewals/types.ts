// Renewals and the retention workflow (Phase 8, ADR-023). Mirrors the database enums.
import type { ContactType } from "@/lib/contacts/types";
import type { OpportunityOutcome, ProductLine } from "@/lib/pipelines";

export const RENEWAL_OUTCOMES = ["renewed", "remarketed", "lost"] as const;
export type RenewalOutcome = (typeof RENEWAL_OUTCOMES)[number];

export const RENEWAL_OUTCOME_LABELS: Readonly<Record<RenewalOutcome, string>> = {
  renewed: "Renewed",
  remarketed: "Re-marketed (kept, terms changed)",
  lost: "Lost (client left)",
};

export const RENEWAL_LOSS_REASONS = [
  "price", "coverage", "other_carrier", "no_longer_needed", "moved_away", "carrier_non_renewed", "other",
] as const;
export type RenewalLossReason = (typeof RENEWAL_LOSS_REASONS)[number];

export const RENEWAL_LOSS_REASON_LABELS: Readonly<Record<RenewalLossReason, string>> = {
  price: "Price",
  coverage: "Coverage",
  other_carrier: "Went to another agent or carrier",
  no_longer_needed: "No longer needed (sold the car or home, etc.)",
  moved_away: "Moved away",
  carrier_non_renewed: "Carrier did not renew",
  other: "Other",
};

export const RENEWAL_WINDOWS = [30, 60, 90] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

/** Row returned by search_renewals. */
export interface RenewalRow {
  id: string;
  contact_id: string;
  product_line: ProductLine;
  outcome: OpportunityOutcome;
  renewal_date: string;
  policy_term_months: number;
  estimated_annual_premium: number | string | null;
  quoted_carrier: string | null;
  review_task_id: string | null;
  review_due_date: string | null;
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string | null;
}

/** A recorded renewal outcome (history; never edited). */
export interface RenewalOutcomeRecord {
  id: string;
  opportunity_id: string;
  renewal_date: string;
  outcome: RenewalOutcome;
  loss_reason: RenewalLossReason | null;
  premium: number | string | null;
  next_renewal_date: string | null;
  notes: string | null;
  recorded_on: string;
  created_at: string;
}
