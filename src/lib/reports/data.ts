import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Period } from "./period";
import type { ReportSummary } from "./types";

/** Every report for the period in one call. RLS limits it to the caller's own records. */
export async function getReport(supabase: SupabaseClient, period: Period, today: string): Promise<ReportSummary> {
  const { data, error } = await supabase.rpc("report_summary", { p_start: period.start, p_end: period.end, p_today: today });
  if (error || !data) throw new Error(`Could not load reports (${error?.code ?? "unknown"}).`);
  return data as ReportSummary;
}
