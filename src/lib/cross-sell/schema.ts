import { z } from "zod";
import { CONTACT_TYPES } from "@/lib/contacts/types";
import { PRODUCT_LINES } from "@/lib/pipelines";

/** Settings form for a cross-sell rule (add or edit). `has_any_lines` comes from checkboxes. */
export const crossSellRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Give the rule a name.").max(100, "Keep the name under 100 characters."),
    reason: z.string().trim().min(1, "Write the reason shown with the prompt.").max(300, "Keep the reason under 300 characters."),
    has_any_lines: z
      .array(z.enum(PRODUCT_LINES))
      .min(1, "Tick at least one line the client already has."),
    lacks_line: z.enum(PRODUCT_LINES, { message: "Choose the line to suggest." }),
    contact_type: z.preprocess((v) => (v === "any" || v === "" || v == null ? null : v), z.enum(CONTACT_TYPES).nullable()),
    enabled: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  })
  .superRefine((v, ctx) => {
    if (v.has_any_lines.includes(v.lacks_line)) {
      ctx.addIssue({ code: "custom", path: ["lacks_line"], message: "Suggest a line that isn't one of the lines they already have." });
    }
  })
  .transform((v) => ({ ...v, has_any_lines: [...new Set(v.has_any_lines)] }));

export type CrossSellRuleInput = z.infer<typeof crossSellRuleSchema>;
