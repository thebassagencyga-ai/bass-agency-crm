// Activity (contact history) shapes and labels. See supabase/migrations.
export const ACTIVITY_TYPES = [
  "call", "meeting", "note", "email", "text_message", "follow_up", "quote", "review_request", "referral_request", "other",
] as const;
export const ACTIVITY_OUTCOMES = [
  "connected", "left_message", "no_answer", "no_response", "requested_follow_up", "quote_requested", "quote_sent",
  "not_interested", "review_left", "referral_received", "declined", "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const ACTIVITY_TYPE_LABELS: Readonly<Record<ActivityType, string>> = {
  call: "Call",
  meeting: "Meeting",
  note: "Note",
  email: "Email (logged)",
  text_message: "Text message (logged)",
  follow_up: "Follow-up",
  quote: "Quote",
  review_request: "Review request",
  referral_request: "Referral request",
  other: "Other",
};
export const ACTIVITY_OUTCOME_LABELS: Readonly<Record<ActivityOutcome, string>> = {
  connected: "Connected",
  left_message: "Left a message",
  no_answer: "No answer",
  no_response: "No response",
  requested_follow_up: "Asked for a follow-up on a date",
  quote_requested: "Quote requested",
  quote_sent: "Quote sent",
  not_interested: "Not interested",
  review_left: "Left a review",
  referral_received: "Referral received",
  declined: "Declined",
  other: "Other",
};

export interface Activity {
  id: string;
  contact_id: string;
  opportunity_id: string | null;
  task_id: string | null;
  activity_type: ActivityType;
  occurred_at: string;
  outcome: ActivityOutcome | null;
  requested_follow_up_on: string | null;
  notes: string | null;
  created_at: string;
}
