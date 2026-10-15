// Server-side validation for opportunity forms. Mirrors the database constraints
// (supabase/migrations) so users see field errors before the database would reject a row.
import { z } from "zod";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { PRODUCT_LINES } from "@/lib/pipelines";
import { parseMoney } from "./format";
import { LOSS_REASONS } from "./types";

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().max(max, `${label} is too long (max ${max} characters).`).nullable());

const optionalDate = z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable());

/** Fields shared by "add" and "edit". */
const detailFields = {
  description: optionalText(500, "Description"),
  quoted_carrier: optionalText(100, "Quoted carrier"),
  quote_sent_on: z.preprocess(
    blankToNull,
    z.string().refine(isIsoDate, "Enter a valid date.").refine((d) => d <= todayInZone(), "This date is in the future.").nullable(),
  ),
  estimated_annual_premium: z.preprocess(
    (v) => (typeof v === "string" ? parseMoney(v) : v ?? null),
    z
      .number({ message: "Enter an amount like 1,250 or 1250.00." })
      .refine((n) => Number.isFinite(n), "Enter an amount like 1,250 or 1250.00.")
      .min(0, "The premium cannot be negative.")
      .max(9_999_999_999.99, "That amount is too large.")
      .nullable(),
  ),
  next_action: optionalText(500, "Next action"),
  effective_date: optionalDate,
  renewal_date: optionalDate,
  // Auto policies renew every 6 or 12 months; every other line yearly (checked per line below).
  policy_term_months: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? 12 : Number(v)),
    z.union([z.literal(6), z.literal(12)], { message: "Choose 6 or 12 months." }),
  ),
};

const renewalAfterEffective = (v: { effective_date: string | null; renewal_date: string | null }, ctx: z.RefinementCtx) => {
  if (v.effective_date && v.renewal_date && v.renewal_date <= v.effective_date) {
    ctx.addIssue({ code: "custom", path: ["renewal_date"], message: "The renewal date must be after the effective date." });
  }
};

export const opportunityDetailsSchema = z.object(detailFields).superRefine(renewalAfterEffective);

/** 6-month terms exist for auto only; other lines are always yearly. */
export function termForLine<T extends { policy_term_months: 6 | 12 }>(data: T, line: string): T {
  return line === "auto" ? data : { ...data, policy_term_months: 12 };
}

export const newOpportunitySchema = z
  .object({
    contact_id: z.uuid("Choose a contact."),
    product_line: z.enum(PRODUCT_LINES, { message: "Choose a product line." }),
    stage_id: z.uuid("Choose a starting stage."),
    ...detailFields,
  })
  .superRefine(renewalAfterEffective);

export const stageChangeSchema = z.object({
  id: z.uuid(),
  stage_id: z.uuid("Choose a stage."),
  loss_reason: z.preprocess(blankToNull, z.enum(LOSS_REASONS, { message: "Choose why it was lost." }).nullable()),
  loss_reason_detail: optionalText(1000, "Loss details"),
});

export type OpportunityDetails = z.infer<typeof opportunityDetailsSchema>;
export type NewOpportunity = z.infer<typeof newOpportunitySchema>;

export const OPPORTUNITY_DETAIL_FIELDS = [
  "description", "quoted_carrier", "quote_sent_on", "estimated_annual_premium", "next_action", "effective_date", "renewal_date",
  "policy_term_months",
] as const;
export const NEW_OPPORTUNITY_FIELDS = ["contact_id", "product_line", "stage_id", ...OPPORTUNITY_DETAIL_FIELDS] as const;
