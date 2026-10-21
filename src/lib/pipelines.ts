// Canonical pipeline definitions (spec §9). The database seeds the same stages in
// supabase/migrations/*_seed_reference_data.sql; tests/db/reference-data.test.ts fails if
// the two ever drift apart.
//
// A stage is where an opportunity sits in the sales process. The final outcome
// (open | won | lost | nurture) is stored separately on the opportunity (ADR-006).

// Phase 30 (ADR-048): thirteen lines, grouped by the starting pipeline each one joins. The order
// matches product_lines.sort_order in the database.
export const PRODUCT_LINES = [
  "auto", "motorcycle", "boat", "rv",
  "home", "renters", "condo", "mobile_home", "umbrella",
  "commercial", "commercial_auto", "farm",
  "life",
] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

/** The four lines with their own starting pipeline (and stage templates). */
export const BASE_LINES = ["auto", "home", "commercial", "life"] as const;
export type BaseLine = (typeof BASE_LINES)[number];

/** The starting pipeline each line joins (product_lines.pipeline_line); also its colour. */
export const LINE_FAMILY: Readonly<Record<ProductLine, BaseLine>> = {
  auto: "auto", motorcycle: "auto", boat: "auto", rv: "auto",
  home: "home", renters: "home", condo: "home", mobile_home: "home", umbrella: "home",
  commercial: "commercial", commercial_auto: "commercial", farm: "commercial",
  life: "life",
};

/** Lines that may have a 6-month term (opportunities_policy_term_check). */
export const SIX_MONTH_LINES: readonly ProductLine[] = ["auto", "motorcycle"];

/** Lines worth a row or tile: the four starting lines always, any other only when it has something. */
export function linesToShow(hasData: (line: ProductLine) => boolean): ProductLine[] {
  return PRODUCT_LINES.filter((l) => (BASE_LINES as readonly string[]).includes(l) || hasData(l));
}

export function isProductLine(value: unknown): value is ProductLine {
  return typeof value === "string" && (PRODUCT_LINES as readonly string[]).includes(value);
}

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
  motorcycle: "Motorcycle",
  boat: "Boat",
  rv: "RV",
  home: "Home",
  renters: "Renters",
  condo: "Condo",
  mobile_home: "Mobile Home",
  umbrella: "Umbrella",
  commercial: "Commercial",
  commercial_auto: "Commercial Auto",
  farm: "Farm",
  life: "Life",
};

export const PIPELINES: Readonly<Record<BaseLine, readonly StageDefinition[]>> = {
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
