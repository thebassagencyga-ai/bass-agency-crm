"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { ruleFormSchema, type Rule } from "@/lib/automation";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { cleanTag, parseTagName } from "@/lib/contacts/tags";
import { crossSellRuleSchema, ruleKeyFromName } from "@/lib/cross-sell";

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

/** Adds or edits a cross-sell rule (Phase 8). The rule key of a new rule comes from its name. */
export async function saveCrossSellRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const f of ["name", "reason", "lacks_line", "contact_type", "enabled"]) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v.slice(0, 500);
  }
  const lines = formData.getAll("has_any_lines").filter((v): v is string => typeof v === "string");
  values.has_any_lines = lines.join(",");
  const parsed = crossSellRuleSchema.safeParse({
    name: formData.get("name") ?? "",
    reason: formData.get("reason") ?? "",
    has_any_lines: lines,
    lacks_line: formData.get("lacks_line"),
    contact_type: formData.get("contact_type"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { fieldErrors, values };
  }

  const id = String(formData.get("id") ?? "");
  if (id) {
    if (!isUuid(id)) return { error: "This rule could not be found.", values };
    const { data, error } = await supabase.from("cross_sell_rules").update(parsed.data).eq("id", id).select("id");
    if (error) return { error: "Could not save this rule. Please check the values and try again.", values };
    if (!data || data.length === 0) return { error: "This rule could not be found.", values };
    revalidatePath("/settings");
    revalidatePath("/renewals");
    return { message: parsed.data.enabled ? "Rule saved." : "Rule saved — it is turned off.", values };
  }

  const ruleKey = `${ruleKeyFromName(parsed.data.name)}_${Date.now().toString(36)}`;
  const { error } = await supabase.from("cross_sell_rules").insert({ ...parsed.data, rule_key: ruleKey });
  if (error) return { error: "Could not add this rule. Please check the values and try again.", values };
  revalidatePath("/settings");
  revalidatePath("/renewals");
  return { message: "Rule added." };
}

/** Rename a tag on every contact, or remove it everywhere (Phase 17). */
export async function renameTag(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const from = cleanTag(String(formData.get("from") ?? ""));
  const remove = formData.get("remove") === "1";
  const { name, error } = parseTagName(remove ? "" : String(formData.get("to") ?? ""));
  if (from === "" || error || (!remove && name === "")) redirect(`/settings?tags=invalid#tags`);
  const { error: dbError } = await supabase.rpc("rename_tag", { p_from: from, p_to: remove ? null : name });
  if (dbError) redirect(`/settings?tags=error#tags`);
  revalidatePath("/contacts");
  redirect(`/settings?tags=${remove ? "removed" : "renamed"}#tags`);
}

/** Add a tag to the list contacts pick from (Phase 20). */
export async function addTag(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const { name, error } = parseTagName(String(formData.get("name") ?? ""));
  if (error || name === "") redirect(`/settings?tags=invalid#tags`);
  const { error: dbError } = await supabase.from("tag_options").insert({ name });
  if (dbError) redirect(`/settings?tags=${dbError.code === "23505" ? "exists" : "error"}#tags`);
  revalidatePath("/contacts");
  redirect(`/settings?tags=added#tags`);
}
