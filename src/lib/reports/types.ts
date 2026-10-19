import type { ContactType } from "@/lib/contacts/types";
import type { ProductLine } from "@/lib/pipelines";

type N = number | string;

/** Shape returned by report_summary (see supabase/migrations/*_reports.sql). */
export interface ReportSummary {
  period: { start: string; end: string; today: string };
  open_pipeline: { pipeline_id: string; pipeline_name: string; pipeline_position: N; stage_name: string; stage_position: number; open_count: N; nurture_count: N; premium: N; with_premium: N }[];
  new_leads: { source: string | null; contacts: N; with_opportunity: N; won: N }[];
  quotes: { product_line: ProductLine; quoted: N; open_count: N; nurture_count: N; won: N; lost: N; premium: N; with_premium: N }[];
  conversion: { product_line: ProductLine; won: N; lost: N; won_premium: N; won_with_premium: N }[];
  tasks: { completed: N; completed_on_time: N; completed_late: N; overdue_now: N };
  renewals: {
    reviews_overdue: N; reviews_next_30: N; reviews_31_60: N; policies_next_90: N;
    outcomes: { renewed: N; remarketed: N; lost: N };
  };
  cross_sell: { by_rule: { rule_name: string; lacks_line: ProductLine; prompts: N }[]; dismissed: N };
  referrals: { referrer_id: string; contact_type: ContactType; first_name: string | null; last_name: string | null; business_name: string | null; referred: N; won: N; working: N }[];
  asks: { review_asked: N; reviews_recorded: N; referral_asked: N; referrals_received: N };
}
