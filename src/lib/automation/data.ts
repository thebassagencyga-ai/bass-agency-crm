import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RULE_ORDER, type Rule } from "./types";

/** The signed-in user's automation rules, in the order shown in Settings. RLS applies. */
export async function getRules(supabase: SupabaseClient): Promise<Rule[]> {
  const { data, error } = await supabase.from("automation_rules").select("*");
  if (error) throw new Error(`Could not load automation rules (${error.code ?? "unknown"}).`);
  const order = (key: string) => {
    const i = (RULE_ORDER as readonly string[]).indexOf(key);
    return i === -1 ? RULE_ORDER.length : i;
  };
  return ((data ?? []) as Rule[]).sort((a, b) => order(a.rule_key) - order(b.rule_key));
}

/** Whether "no response" follow-ups wait for the owner to confirm (rule enabled + confirm). */
export async function noResponseNeedsConfirmation(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.from("automation_rules").select("enabled, config").eq("rule_key", "no_response_follow_up").maybeSingle();
  const rule = data as Pick<Rule, "enabled" | "config"> | null;
  return Boolean(rule?.enabled && rule.config?.confirm_before_creating);
}
