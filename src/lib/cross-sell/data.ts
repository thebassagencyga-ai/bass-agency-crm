import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrossSellPrompt, CrossSellRule } from "./types";

export async function getCrossSellRules(supabase: SupabaseClient): Promise<CrossSellRule[]> {
  const { data, error } = await supabase
    .from("cross_sell_rules")
    .select("id, rule_key, name, has_any_lines, lacks_line, contact_type, reason, enabled")
    .order("created_at")
    .order("rule_key");
  if (error) throw new Error(`Could not load cross-sell rules (${error.code ?? "unknown"}).`);
  return (data ?? []) as CrossSellRule[];
}

/** Current prompts (all contacts, or one). RLS limits them to the caller's own records. */
export async function crossSellPrompts(
  supabase: SupabaseClient,
  today: string,
  opts: { contactId?: string; limit?: number } = {},
): Promise<CrossSellPrompt[]> {
  const { data, error } = await supabase.rpc("cross_sell_prompts", {
    p_today: today,
    p_contact_id: opts.contactId ?? null,
    p_limit: opts.limit ?? 50,
  });
  if (error) throw new Error(`Could not load cross-sell reviews (${error.code ?? "unknown"}).`);
  return (data ?? []) as CrossSellPrompt[];
}
