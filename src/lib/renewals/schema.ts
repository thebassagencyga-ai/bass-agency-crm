import { z } from "zod";
import { parseMoney } from "@/lib/opportunities/format";
import { RENEWAL_LOSS_REASONS, RENEWAL_OUTCOMES } from "./types";

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v ?? null);

/** The "record renewal outcome" form. A loss needs a reason; a premium only applies when kept. */
export const renewalOutcomeSchema = z
  .object({
    opportunity_id: z.uuid("This policy could not be found."),
    outcome: z.enum(RENEWAL_OUTCOMES, { message: "Choose what happened at renewal." }),
    loss_reason: z.preprocess(blankToNull, z.enum(RENEWAL_LOSS_REASONS, { message: "Choose why the client left." }).nullable()),
    premium: z.preprocess(
      (v) => (typeof v === "string" ? parseMoney(v) : v ?? null),
      z
        .number({ message: "Enter an amount like 1,250 or 1250.00." })
        .refine((n) => Number.isFinite(n), "Enter an amount like 1,250 or 1250.00.")
        .min(0, "The premium cannot be negative.")
        .max(9_999_999_999.99, "That amount is too large.")
        .nullable(),
    ),
    notes: z.preprocess(blankToNull, z.string().max(1000, "Notes are too long (max 1,000 characters).").nullable()),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "lost" && !v.loss_reason) {
      ctx.addIssue({ code: "custom", path: ["loss_reason"], message: "Choose why the client left." });
    }
  })
  .transform((v) => ({
    ...v,
    loss_reason: v.outcome === "lost" ? v.loss_reason : null,
    premium: v.outcome === "lost" ? null : v.premium,
  }));

export type RenewalOutcomeInput = z.infer<typeof renewalOutcomeSchema>;
export const RENEWAL_OUTCOME_FIELDS = ["opportunity_id", "outcome", "loss_reason", "premium", "notes"] as const;
