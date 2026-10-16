// Shapes of opportunity rows as read through the Data API (see supabase/migrations).
import type { ContactType } from "@/lib/contacts/types";
import type { OpportunityOutcome, ProductLine, StageKind } from "@/lib/pipelines";

export const LOSS_REASONS = [
  "price", "coverage", "chose_competitor", "stayed_with_current", "no_response", "not_eligible", "timing", "other",
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Readonly<Record<LossReason, string>> = {
  price: "Price",
  coverage: "Coverage",
  chose_competitor: "Chose another agency or carrier",
  stayed_with_current: "Stayed with current insurance",
  no_response: "No response",
  not_eligible: "Not eligible",
  timing: "Timing",
  other: "Other",
};

export const OUTCOME_LABELS: Readonly<Record<OpportunityOutcome, string>> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};

/** A pipeline stage as stored in the database (ids differ per environment). */
export interface Stage {
  id: string;
  product_line: ProductLine;
  code: string;
  name: string;
  position: number;
  kind: StageKind;
}

export interface Opportunity {
  id: string;
  contact_id: string;
  product_line: ProductLine;
  stage_id: string;
  stage_kind: StageKind;
  outcome: OpportunityOutcome;
  description: string | null;
  quoted_carrier: string | null;
  quote_sent_on: string | null;
  estimated_annual_premium: number | string | null;
  next_action: string | null;
  effective_date: string | null;
  renewal_date: string | null;
  /** 12, or 6 for auto (Phase 8). */
  policy_term_months: number;
  /** Set when a renewal was recorded as lost: the policy is no longer active (Phase 8). */
  policy_ended_on: string | null;
  /** From intake (Phase 13): the prospect's current insurer and when that policy renews. */
  current_carrier: string | null;
  current_policy_renews_on: string | null;
  loss_reason: LossReason | null;
  loss_reason_detail: string | null;
  closed_at: string | null;
  cycle: number;
  created_at: string;
  updated_at: string;
}

/** Row returned by search_opportunities: the opportunity plus stage and contact names. */
export interface OpportunityListRow extends Omit<Opportunity, "loss_reason" | "loss_reason_detail" | "policy_term_months" | "policy_ended_on" | "current_carrier" | "current_policy_renews_on"> {
  stage_name: string;
  stage_position: number;
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
}
