// Automation rule shapes (supabase/migrations: automation_rules) and plain-English descriptions.
import type { TaskCategory, TaskPriority } from "@/lib/tasks/types";

export type RuleAction = "create_task" | "close_prospecting_tasks" | "create_checklist";
export type RuleAnchor = "event_date" | "requested_date" | "renewal_date";
export type DayCount = "calendar" | "business";

export interface Rule {
  id: string;
  rule_key: string;
  name: string;
  trigger_event: string;
  action: RuleAction;
  anchor: RuleAnchor;
  offset_days: number;
  day_count: DayCount;
  task_title_template: string | null;
  task_priority: TaskPriority;
  task_category: TaskCategory;
  completion_window_days: number;
  cooldown_days: number | null;
  enabled: boolean;
  config: { items?: string[]; message_template?: string; confirm_before_creating?: boolean; [key: string]: unknown };
}

/**
 * Display order on the Settings page: the sales sequence first, then win/loss, then renewal,
 * then the Focus rules (Phase 27).
 */
export const RULE_ORDER = [
  "new_lead_initial_contact", "contacted_no_quote_follow_up", "quote_sent_follow_up", "requested_follow_up",
  "no_response_follow_up", "won_close_prospecting", "won_onboarding_checklist", "review_request", "referral_request",
  "lost_close_prospecting", "renewal_review", "reopened_restart",
  "nurture_check_back", "prospect_requote", "referrer_thank_you",
] as const;

const WHEN: Record<string, string> = {
  opportunity_created: "a new opportunity starts at its pipeline's first stage",
  initial_contact_no_quote: "the first-contact task is completed and no quote has been sent",
  quote_sent: "a quote-sent date is entered",
  follow_up_requested: "you log that the prospect asked for a follow-up on a date",
  no_response: "you log a call or follow-up with no response",
  opportunity_won: "an opportunity is won",
  opportunity_lost: "an opportunity is lost",
  renewal_date_known: "a renewal date is entered",
  opportunity_reopened: "a won or lost opportunity is reopened",
  nurture_started: "an opportunity is moved to nurture with a check-back date",
  current_policy_renewal_known: "a prospect's current policy renewal date is entered (any deal not won)",
  referral_received: "a contact is linked to the person who referred them",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "When a quote-sent date is entered: task due 3 calendar days later." */
export function describeRule(rule: Pick<Rule, "trigger_event" | "action" | "anchor" | "offset_days" | "day_count" | "completion_window_days" | "cooldown_days">): string {
  const when = `When ${WHEN[rule.trigger_event] ?? rule.trigger_event}`;
  if (rule.action === "close_prospecting_tasks") return `${when}: its open prospecting tasks are closed.`;
  const unit = rule.day_count === "business" ? "business day" : "day";
  let timing: string;
  if (rule.anchor === "requested_date") timing = rule.trigger_event === "nurture_started" ? "due on the check-back date" : "due on the date they asked for";
  else if (rule.anchor === "renewal_date") timing = `due ${plural(Math.abs(rule.offset_days), unit)} before the renewal date`;
  else if (rule.offset_days === 0) timing = "due the same day";
  else timing = `${rule.completion_window_days > 0 ? "starts" : "due"} ${plural(rule.offset_days, unit)} later`;
  if (rule.completion_window_days > 0) timing += `, due ${plural(rule.completion_window_days, "day")} after that`;
  const what = rule.action === "create_checklist" ? "checklist tasks" : "a task";
  const cooldown = rule.cooldown_days ? ` Not repeated for the same contact within ${plural(rule.cooldown_days, "day")}.` : "";
  return `${when}: ${what} ${timing}.${cooldown}`;
}
