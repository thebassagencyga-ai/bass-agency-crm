// A policy the client already has, entered by hand (ADR-042). Saved directly as won, like an
// imported policy, so no new-sale tasks are created and reports do not count it as a sale.
import { z } from "zod";
import { addMonths, isIsoDate } from "@/lib/dates";
import { PRODUCT_LINES, SIX_MONTH_LINES } from "@/lib/pipelines";
import { parseMoney } from "./format";

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};
const optionalDate = z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable());

export const existingPolicySchema = z
  .object({
    contact_id: z.uuid("Choose a contact."),
    product_line: z.enum(PRODUCT_LINES, { message: "Choose a product line." }),
    quoted_carrier: z.preprocess(blankToNull, z.string().max(100, "Carrier is too long (max 100 characters).").nullable()),
    estimated_annual_premium: z.preprocess(
      (v) => (typeof v === "string" ? parseMoney(v) : v ?? null),
      z
        .number({ message: "Enter an amount like 1,250 or 1250.00." })
        .refine((n) => Number.isFinite(n), "Enter an amount like 1,250 or 1250.00.")
        .min(0, "The premium cannot be negative.")
        .max(9_999_999_999.99, "That amount is too large.")
        .nullable(),
    ),
    effective_date: optionalDate,
    renewal_date: optionalDate,
    policy_term_months: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? 12 : Number(v)),
      z.union([z.literal(6), z.literal(12)], { message: "Choose 6 or 12 months." }),
    ),
    description: z.preprocess(blankToNull, z.string().max(500, "Description is too long (max 500 characters).").nullable()),
  })
  .superRefine((v, ctx) => {
    if (!v.effective_date && !v.renewal_date) {
      ctx.addIssue({ code: "custom", path: ["effective_date"], message: "Enter the effective date or the renewal date." });
    }
    if (v.effective_date && v.renewal_date && v.renewal_date <= v.effective_date) {
      ctx.addIssue({ code: "custom", path: ["renewal_date"], message: "The renewal date must be after the effective date." });
    }
  });

export type ExistingPolicy = z.infer<typeof existingPolicySchema>;
export const EXISTING_POLICY_FIELDS = [
  "contact_id", "product_line", "quoted_carrier", "estimated_annual_premium", "effective_date", "renewal_date",
  "policy_term_months", "description",
] as const;

/**
 * The next renewal on or after today. A renewal date already passed has renewed since, so it
 * moves forward by the term (as the import does). With no renewal date, it is worked out from
 * the effective date. Returns null when neither date is given.
 */
export function nextRenewal(effective: string | null, renewal: string | null, termMonths: 6 | 12, today: string): string | null {
  let next = renewal ?? (effective ? addMonths(effective, termMonths) : null);
  if (!next) return null;
  // Step from the original date each time so month-end dates do not drift (Jan 31 → Jul 31).
  const start = next;
  for (let n = 1; next < today; n++) next = addMonths(start, termMonths * n);
  return next;
}

/** The row to insert: won at the line's Bound stage, marked as an existing policy. */
export function existingPolicyRow(data: ExistingPolicy, wonStageId: string, today: string) {
  const term = (SIX_MONTH_LINES as readonly string[]).includes(data.product_line) ? data.policy_term_months : 12;
  return {
    contact_id: data.contact_id,
    product_line: data.product_line,
    stage_id: wonStageId,
    outcome: "won" as const,
    existing_policy: true,
    quoted_carrier: data.quoted_carrier,
    estimated_annual_premium: data.estimated_annual_premium,
    effective_date: data.effective_date,
    renewal_date: nextRenewal(data.effective_date, data.renewal_date, term, today),
    policy_term_months: term,
    description: data.description,
  };
}
