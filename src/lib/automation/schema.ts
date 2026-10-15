// Server-side validation for editing an automation rule in Settings.
import { z } from "zod";
import { TASK_PRIORITIES } from "@/lib/tasks/types";

/** Google's review policy forbids incentives; Georgia inducement rules may restrict them (ADR-013). */
export const INCENTIVE_WORDS = /\b(gift|gifts|discount|discounts|reward|rewards|prize|prizes|entry|entries|drawing|raffle|free|coupon|gift card)\b|\$/i;

const toInt = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v === undefined || v === "" ? undefined : v);

export const ruleFormSchema = z.object({
  enabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  days: z.preprocess(toInt, z.number({ message: "Enter a number of days." }).int("Use whole days.").min(0, "Use 0 or more.").max(365, "Use 365 or fewer.").optional()),
  day_count: z.enum(["calendar", "business"]).optional(),
  task_title_template: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "Enter a task title.").max(200, "Keep the title under 200 characters.").optional(),
  ),
  task_priority: z.enum(TASK_PRIORITIES).optional(),
  completion_window_days: z.preprocess(toInt, z.number().int("Use whole days.").min(0).max(365, "Use 365 or fewer.").optional()),
  cooldown_days: z.preprocess(toInt, z.number().int("Use whole days.").min(1, "Use at least 1 day.").max(1095, "Use 1,095 or fewer.").optional()),
  confirm_before_creating: z.preprocess((v) => (v === undefined ? undefined : v === "on" || v === "true"), z.boolean().optional()),
  items: z.preprocess(
    (v) => (typeof v === "string" ? v.split("\n").map((s) => s.trim()).filter(Boolean) : v),
    z.array(z.string().max(200, "Keep each item under 200 characters.")).min(1, "Add at least one item.").max(10, "Use 10 items or fewer.").optional(),
  ),
  message_template: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string()
      .min(1, "Enter the message.")
      .max(1000, "Keep the message under 1,000 characters.")
      .refine((t) => !INCENTIVE_WORDS.test(t), "Messages can't offer anything in return (Google's review policy and insurance rules).")
      .optional(),
  ),
});

export type RuleForm = z.infer<typeof ruleFormSchema>;
