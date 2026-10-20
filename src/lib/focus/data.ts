import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FocusList } from "./index";

/** The Focus list in one call (Phase 27). RLS limits it to the caller's own records. */
export async function getFocus(supabase: SupabaseClient, today: string): Promise<FocusList> {
  const { data, error } = await supabase.rpc("focus_list", { p_today: today });
  if (error || !data) throw new Error(`Could not load Focus (${error?.code ?? "unknown"}).`);
  return data as FocusList;
}

/** Days before renewal of the agent's re-quote rule, or null when the rule is turned off. */
export async function requoteRuleDays(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase.from("automation_rules").select("offset_days, enabled").eq("rule_key", "prospect_requote").maybeSingle();
  if (!data || !data.enabled) return null;
  return Math.abs(data.offset_days as number);
}
