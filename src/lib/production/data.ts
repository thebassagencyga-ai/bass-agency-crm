import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionReport } from "./index";

/** The Production report for a month, in one call (Phase 28). RLS limits it to the caller's own records. */
export async function getProduction(supabase: SupabaseClient, month: string): Promise<ProductionReport> {
  const { data, error } = await supabase.rpc("production_report", { p_month: month });
  if (error || !data) throw new Error(`Could not load the Production report (${error?.code ?? "unknown"}).`);
  return data as ProductionReport;
}

export interface RateRow { id: string; product_line: string; life_policy_type: string | null; new_rate: number | string | null; renewal_rate: number | string | null }
export interface GoalsRow { id: string; premium_per_month: number | string | null; policies_per_month: number | null; premium_per_year: number | string | null }

export async function getRatesAndGoals(supabase: SupabaseClient): Promise<{ rates: RateRow[]; goals: GoalsRow | null }> {
  const [rates, goals] = await Promise.all([
    supabase.from("commission_rates").select("id, product_line, life_policy_type, new_rate, renewal_rate"),
    supabase.from("production_goals").select("id, premium_per_month, policies_per_month, premium_per_year").maybeSingle(),
  ]);
  if (rates.error) throw new Error(`Could not load your rates (${rates.error.code ?? "unknown"}).`);
  return { rates: (rates.data ?? []) as RateRow[], goals: (goals.data as GoalsRow | null) ?? null };
}

/** First-year rate for a life policy type from Settings, or null. */
export async function lifeRate(supabase: SupabaseClient, type: string | null): Promise<number | null> {
  if (!type) return null;
  const { data } = await supabase.from("commission_rates").select("new_rate").eq("product_line", "life").eq("life_policy_type", type).maybeSingle();
  return data?.new_rate === null || data?.new_rate === undefined ? null : Number(data.new_rate);
}
