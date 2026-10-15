import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityOutcome, ActivityType } from "@/lib/activities/types";
import type { ContactType } from "@/lib/contacts/types";
import type { OpportunityOutcome, ProductLine } from "@/lib/pipelines";

type Named = { contact_type: ContactType; first_name: string | null; last_name: string | null; business_name: string | null };

export interface DashboardSummary {
  tasks: { overdue: number; due_today: number; upcoming_7_days: number };
  open_by_line: { product_line: ProductLine; open_count: number; nurture_count: number; premium: number | string }[];
  renewals: { next_60_days: number; soonest: (Named & { id: string; product_line: ProductLine; renewal_date: string; outcome: OpportunityOutcome })[] };
  recent_activity: (Named & { id: string; contact_id: string; activity_type: ActivityType; outcome: ActivityOutcome | null; occurred_at: string; notes: string | null })[];
}

/** Everything the dashboard needs in one call. RLS limits it to the caller's own records. */
export async function getDashboard(supabase: SupabaseClient, today: string): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc("dashboard_summary", { p_today: today });
  if (error || !data) throw new Error(`Could not load the dashboard (${error?.code ?? "unknown"}).`);
  return data as DashboardSummary;
}
