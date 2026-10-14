// Canonical pipeline definitions (spec §9). The database seeds the same stages in
// supabase/migrations/*_seed_reference_data.sql; tests/db/reference-data.test.ts fails if
// the two ever drift apart.
//
// A stage is where an opportunity sits in the sales process. The final outcome
// (open | won | lost | nurture) is stored separately on the opportunity (ADR-006).

export const PRODUCT_LINES = ["auto", "home", "commercial", "life"] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const OPPORTUNITY_OUTCOMES = ["open", "won", "lost", "nurture"] as const;
export type OpportunityOutcome = (typeof OPPORTUNITY_OUTCOMES)[number];

/** `won` / `lost` stages are terminal; every other stage is `active`. */
export type StageKind = "active" | "won" | "lost";

export interface StageDefinition {
  readonly code: string;
  readonly name: string;
  readonly kind: StageKind;
}

export const PRODUCT_LINE_NAMES: Readonly<Record<ProductLine, string>> = {
  auto: "Auto",
  home: "Home",
  commercial: "Commercial",
  life: "Life",
};

export const PIPELINES: Readonly<Record<ProductLine, readonly StageDefinition[]>> = {
  auto: [
    { code: "new_lead", name: "New Lead", kind: "active" },
    { code: "contacted", name: "Contacted", kind: "active" },
    { code: "info_needed", name: "Info Needed", kind: "active" },
    { code: "quoted", name: "Quoted", kind: "active" },
    { code: "follow_up", name: "Follow Up", kind: "active" },
    { code: "bound", name: "Bound", kind: "won" },
    { code: "lost", name: "Lost", kind: "lost" },
  ],
  home: [
    { code: "new_lead", name: "New Lead", kind: "active" },
    { code: "contacted", name: "Contacted", kind: "active" },
    { code: "property_info_needed", name: "Property Info Needed", kind: "active" },
    { code: "quoted", name: "Quoted", kind: "active" },
    { code: "follow_up", name: "Follow Up", kind: "active" },
    { code: "bound", name: "Bound", kind: "won" },
    { code: "lost", name: "Lost", kind: "lost" },
  ],
  commercial: [
    { code: "new_lead", name: "New Lead", kind: "active" },
    { code: "discovery", name: "Discovery", kind: "active" },
    { code: "info_needed", name: "Info Needed", kind: "active" },
    { code: "marketing_quoting", name: "Marketing or Quoting", kind: "active" },
    { code: "proposal_presented", name: "Proposal Presented", kind: "active" },
    { code: "follow_up", name: "Follow Up", kind: "active" },
    { code: "bound", name: "Bound", kind: "won" },
    { code: "lost", name: "Lost", kind: "lost" },
  ],
  // Application Process and Decision Pending are active stages: an application submitted
  // is not a placed policy. Only Placed is a won outcome.
  life: [
    { code: "new_lead", name: "New Lead", kind: "active" },
    { code: "contacted", name: "Contacted", kind: "active" },
    { code: "appointment_set", name: "Appointment Set", kind: "active" },
    { code: "needs_review", name: "Needs Review", kind: "active" },
    { code: "application_process", name: "Application Process", kind: "active" },
    { code: "decision_pending", name: "Decision Pending", kind: "active" },
    { code: "placed", name: "Placed", kind: "won" },
    { code: "lost", name: "Lost", kind: "lost" },
  ],
};

/** Outcomes each stage kind may carry. Mirrors the opportunities_stage_outcome_check constraint. */
export const OUTCOMES_FOR_STAGE_KIND: Readonly<Record<StageKind, readonly OpportunityOutcome[]>> = {
  active: ["open", "nurture"],
  won: ["won"],
  lost: ["lost"],
};

export function isOutcomeAllowedForStage(kind: StageKind, outcome: OpportunityOutcome): boolean {
  return OUTCOMES_FOR_STAGE_KIND[kind].includes(outcome);
}
