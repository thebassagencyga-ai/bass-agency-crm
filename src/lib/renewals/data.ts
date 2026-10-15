import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RenewalParams } from "./params";
import type { RenewalOutcomeRecord, RenewalRow } from "./types";

/** Policies and prospects renewing within the window (RLS limits it to the caller's own). */
export async function searchRenewals(supabase: SupabaseClient, params: RenewalParams, today: string): Promise<RenewalRow[]> {
  const { data, error } = await supabase.rpc("search_renewals", { p_today: today, p_days: params.days, p_product_line: params.line });
  if (error) throw new Error(`Could not load renewals (${error.code ?? "unknown"}).`);
  return (data ?? []) as RenewalRow[];
}

/** Retention history for one policy, newest first. */
export async function outcomesFor(supabase: SupabaseClient, opportunityId: string): Promise<RenewalOutcomeRecord[]> {
  const { data, error } = await supabase
    .from("renewal_outcomes")
    .select("id, opportunity_id, renewal_date, outcome, loss_reason, premium, next_renewal_date, notes, recorded_on, created_at")
    .eq("opportunity_id", opportunityId)
    .order("renewal_date", { ascending: false });
  if (error) throw new Error(`Could not load renewal history (${error.code ?? "unknown"}).`);
  return (data ?? []) as RenewalOutcomeRecord[];
}
