// Intake form (Phase 13, ADR-028): shared constants and types.
import type { HouseholdRelationship } from "@/lib/contacts/details";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

export const INTAKE_LINES = PRODUCT_LINES;
export const INTAKE_LINE_LABELS: Readonly<Record<ProductLine, string>> = PRODUCT_LINE_NAMES;

export const INTAKE_CONTACT_METHODS = ["phone", "text", "email"] as const;
export const INTAKE_CONTACT_METHOD_LABELS: Record<(typeof INTAKE_CONTACT_METHODS)[number], string> = {
  phone: "Phone call",
  text: "Text message",
  email: "Email",
};

export const HEARD_ABOUT_OPTIONS = [
  "Referral", "Google search", "Facebook or social media", "Saw the office or a sign", "Already a customer", "Other",
] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Shown next to the consent checkbox. Changing the wording means a new version (stored per submission). */
export const CONSENT_VERSION = "v1";
export const CONSENT_TEXT =
  "I agree that The Bass Agency may contact me about insurance by phone, text message or email using the details above. Agreeing is not a condition of buying anything.";

export interface CoverageEntry {
  line: ProductLine;
  carrier: string | null;
  renews_month: number | null;
}

export interface HouseholdEntry {
  first_name: string;
  last_name: string | null;
  relationship: HouseholdRelationship;
}

export interface VehicleEntry {
  year: number;
  make: string;
  model: string | null;
}

/** The form as sent to the database (submit_intake / quick_intake). */
export interface IntakePayload {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  preferred_contact_method: (typeof INTAKE_CONTACT_METHODS)[number] | null;
  best_time: string | null;
  lines: ProductLine[];
  current_coverage: CoverageEntry[];
  heard_about: string | null;
  referred_by_name: string | null;
  household: HouseholdEntry[];
  vehicles: VehicleEntry[];
}

/** A row of the review inbox (status "new": details present). */
export interface IntakeSubmission extends Omit<IntakePayload, "current_coverage" | "lines"> {
  id: string;
  status: "new" | "accepted" | "discarded";
  lines: ProductLine[];
  current_coverage: CoverageEntry[];
  submitted_at: string;
  consent_at: string;
}

export interface IntakeLink {
  id: string;
  token: string;
  enabled: boolean;
  created_at: string;
}
