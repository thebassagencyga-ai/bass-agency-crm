"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { ruleFormSchema, type Rule } from "@/lib/automation";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";

const FIELDS = [
  "enabled", "days", "day_count", "task_title_template", "task_priority", "completion_window_days", "cooldown_days",
  "confirm_before_creating", "items", "message_template",
] as const;

/** Saves one automation rule. Only fields that make sense for the rule's action are written. */
export async function updateRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v.slice(0, 2000);
  }
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { error: "This rule could not be found.", values };
  const { data: existing } = await supabase.from("automation_rules").select("*").eq("id", id).maybeSingle();
  const rule = existing as Rule | null;
  if (!rule) return { error: "This rule could not be found.", values };

  const raw = Object.fromEntries(FIELDS.map((f) => [f, formData.get(f) ?? undefined]));
  const parsed = ruleFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { fieldErrors, values };
  }
  const f = parsed.data;
  const update: Record<string, unknown> = { enabled: f.enabled };
  const config = { ...rule.config };

  if (rule.action === "create_task") {
    if (f.task_title_template !== undefined) update.task_title_template = f.task_title_template;
    if (f.task_priority !== undefined) update.task_priority = f.task_priority;
    if (f.days !== undefined && rule.anchor !== "requested_date") {
      // Renewal reviews count back from the renewal date.
      update.offset_days = rule.anchor === "renewal_date" ? -f.days : f.days;
    }
    if (f.day_count !== undefined && rule.anchor === "event_date") update.day_count = f.day_count;
    if (f.completion_window_days !== undefined) update.completion_window_days = f.completion_window_days;
    if (f.cooldown_days !== undefined && rule.cooldown_days !== null) update.cooldown_days = f.cooldown_days;
    if (f.message_template !== undefined && typeof rule.config.message_template === "string") config.message_template = f.message_template;
    if (rule.rule_key === "no_response_follow_up") config.confirm_before_creating = f.confirm_before_creating ?? false;
  } else if (rule.action === "create_checklist" && f.items !== undefined) {
    config.items = f.items;
  }
  update.config = config;

  const { error } = await supabase.from("automation_rules").update(update).eq("id", rule.id);
  if (error) return { error: "Could not save this rule. Please check the values and try again.", values };
  revalidatePath("/settings");
  return { message: f.enabled ? "Rule saved." : "Rule saved — it is turned off.", values };
}
