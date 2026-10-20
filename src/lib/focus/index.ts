// ProducrIQ Focus (Phase 27, ADR-045): the shapes returned by focus_list, the reason lines shown
// on each card, and the date choices for snoozing and nurture check-backs. Pure functions: the
// rules that decide what is listed live in the database (supabase/migrations/…_focus.sql).
import { z } from "zod";
import { addDays, addMonths, formatDateOnly, isIsoDate } from "@/lib/dates";
import type { ContactType } from "@/lib/contacts/types";
import type { ProductLine } from "@/lib/pipelines";
import type { LossReason } from "@/lib/opportunities/types";

/** Owner decision 3: a quote is quiet after 3 days without meaningful activity, other open deals after 7. */
export const QUIET_QUOTE_DAYS = 3;
export const QUIET_OPEN_DAYS = 7;
/** Cards shown per group before "Show all". */
export const FOCUS_SHOWN = 5;

interface FocusContact {
  contact_id: string;
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string | null;
  email: string | null;
}

export interface FocusDeal extends FocusContact {
  opportunity_id: string;
  product_line: ProductLine;
  stage_name: string;
  estimated_annual_premium: number | string | null;
  quote_sent_on: string | null;
  last_touch_on: string;
  current_carrier: string | null;
  current_policy_renews_on: string | null;
  loss_reason: LossReason | null;
}

export interface QuietDeal extends FocusDeal {
  days_quiet: number;
  focus_snoozed_until: string | null;
}

export interface NurtureDeal extends FocusDeal {
  nurture_check_back_on: string | null;
}

export interface FocusTask extends FocusContact {
  task_id: string;
  title: string;
  due_date: string;
  opportunity_id: string | null;
  product_line: ProductLine | null;
  outcome: "open" | "nurture" | "won" | "lost" | null;
  current_carrier: string | null;
  current_policy_renews_on: string | null;
  loss_reason: LossReason | null;
}

export interface FocusList {
  today: string;
  quiet_quotes: QuietDeal[];
  quiet_open: QuietDeal[];
  nurture: NurtureDeal[];
  requote: FocusTask[];
  thanks: FocusTask[];
}

export const focusCount = (f: FocusList) =>
  f.quiet_quotes.length + f.quiet_open.length + f.nurture.length + f.requote.length + f.thanks.length;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Quote sent Oct 14. Nothing logged in 6 days." */
export function quietReason(d: Pick<QuietDeal, "days_quiet" | "quote_sent_on" | "last_touch_on">, quote: boolean): string {
  const quiet = `Nothing logged in ${plural(d.days_quiet, "day")}.`;
  if (quote && d.quote_sent_on) return `Quote sent ${formatDateOnly(d.quote_sent_on)}. ${quiet}`;
  return `Last activity ${formatDateOnly(d.last_touch_on)}. ${quiet}`;
}

/** "Check back today." / "Check back was due Oct 2." / "No check-back date yet." */
export function nurtureReason(d: Pick<NurtureDeal, "nurture_check_back_on">, today: string): string {
  if (!d.nurture_check_back_on) return "No check-back date yet. Pick one so this deal comes back on time.";
  if (d.nurture_check_back_on === today) return "Check back today.";
  return `Check back was due ${formatDateOnly(d.nurture_check_back_on)}.`;
}

/** "Current policy with Example Mutual renews Dec 4." */
export function requoteReason(t: Pick<FocusTask, "current_carrier" | "current_policy_renews_on" | "outcome">): string {
  const carrier = t.current_carrier ? ` with ${t.current_carrier}` : "";
  const renews = t.current_policy_renews_on ? ` renews ${formatDateOnly(t.current_policy_renews_on)}` : " renews soon";
  const lost = t.outcome === "lost" ? " Lost earlier, so this is a second chance." : "";
  return `Current policy${carrier}${renews}.${lost}`;
}

/**
 * When the re-quote task for a renewal date would be due, with the rule's days before it: never
 * before today, and none once the date has passed (same as the database).
 */
export function requoteDueOn(renewsOn: string, daysBefore: number, today: string): string | null {
  if (!isIsoDate(renewsOn) || renewsOn < today) return null;
  const due = addDays(renewsOn, -Math.abs(daysBefore));
  return due < today ? today : due;
}

export const SNOOZE_CHOICES = [
  { value: "3", label: "3 days" },
  { value: "7", label: "1 week" },
] as const;

export const snoozeSchema = z.object({
  id: z.uuid(),
  days: z.enum(["3", "7"], { message: "Choose how long to snooze." }),
});

/** The date a snoozed deal comes back. */
export const snoozeUntil = (today: string, days: "3" | "7") => addDays(today, Number(days));

export const CHECK_BACK_CHOICES = [
  { value: "30d", label: "In 30 days" },
  { value: "3m", label: "In 3 months" },
  { value: "6m", label: "In 6 months" },
  { value: "date", label: "Pick a date" },
] as const;
export type CheckBackChoice = (typeof CHECK_BACK_CHOICES)[number]["value"];
/** Owner decision 3: 30 days when the agent does not choose. */
export const DEFAULT_CHECK_BACK: CheckBackChoice = "30d";

/** The check-back date for a choice; a picked date must be after today and within two years. */
export function checkBackDate(
  today: string, choice: string, picked: string | null,
): { ok: true; date: string } | { ok: false; message: string } {
  switch (choice) {
    case "30d": return { ok: true, date: addDays(today, 30) };
    case "3m": return { ok: true, date: addMonths(today, 3) };
    case "6m": return { ok: true, date: addMonths(today, 6) };
    case "date": {
      const d = picked?.trim() ?? "";
      if (!isIsoDate(d)) return { ok: false, message: "Enter the date to check back." };
      if (d <= today) return { ok: false, message: "Pick a date after today." };
      if (d > addMonths(today, 24)) return { ok: false, message: "Pick a date within two years." };
      return { ok: true, date: d };
    }
    default: return { ok: false, message: "Choose when to check back." };
  }
}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v ?? null);

/** The deal page's "Current coverage elsewhere" card. */
export const coverageSchema = z.object({
  id: z.uuid(),
  current_carrier: z.preprocess(blankToNull, z.string().max(100, "The carrier name is too long (max 100 characters).").nullable()),
  current_policy_renews_on: z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable()),
});
