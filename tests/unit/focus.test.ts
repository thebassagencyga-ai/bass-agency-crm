import { describe, expect, it } from "vitest";
import { describeRule } from "@/lib/automation/types";
import {
  CHECK_BACK_CHOICES, DEFAULT_CHECK_BACK, checkBackDate, coverageSchema, focusCount, nurtureReason, quietReason, requoteDueOn,
  requoteReason, snoozeSchema, snoozeUntil, type FocusList,
} from "@/lib/focus";

// Phase 27 (ADR-045): Focus reasons and date choices. The listing rules themselves are tested
// against the database in tests/db/focus.test.ts.

const TODAY = "2026-10-20";

describe("reason lines", () => {
  it("quiet quotes name the quote date; other deals the last activity", () => {
    expect(quietReason({ days_quiet: 6, quote_sent_on: "2026-10-14", last_touch_on: "2026-10-14" }, true))
      .toBe("Quote sent Oct 14, 2026. Nothing logged in 6 days.");
    expect(quietReason({ days_quiet: 1, quote_sent_on: null, last_touch_on: "2026-10-19" }, true))
      .toBe("Last activity Oct 19, 2026. Nothing logged in 1 day.");
    expect(quietReason({ days_quiet: 9, quote_sent_on: null, last_touch_on: "2026-10-11" }, false))
      .toBe("Last activity Oct 11, 2026. Nothing logged in 9 days.");
  });

  it("nurture: due today, overdue, or no date yet", () => {
    expect(nurtureReason({ nurture_check_back_on: TODAY }, TODAY)).toBe("Check back today.");
    expect(nurtureReason({ nurture_check_back_on: "2026-10-02" }, TODAY)).toBe("Check back was due Oct 2, 2026.");
    expect(nurtureReason({ nurture_check_back_on: null }, TODAY)).toMatch(/^No check-back date yet/);
  });

  it("re-quote: carrier and date when known; a lost deal is a second chance", () => {
    expect(requoteReason({ current_carrier: "Example Mutual", current_policy_renews_on: "2026-12-04", outcome: "open" }))
      .toBe("Current policy with Example Mutual renews Dec 4, 2026.");
    expect(requoteReason({ current_carrier: null, current_policy_renews_on: null, outcome: "lost" }))
      .toBe("Current policy renews soon. Lost earlier, so this is a second chance.");
  });

  it("counts every item", () => {
    const f = { today: TODAY, quiet_quotes: [{}], quiet_open: [], nurture: [{}, {}], requote: [], thanks: [{}] } as unknown as FocusList;
    expect(focusCount(f)).toBe(4);
  });
});

describe("re-quote date preview (same rules as the database)", () => {
  it("is the given days before the renewal, today when closer, none once passed", () => {
    expect(requoteDueOn("2026-12-04", 45, TODAY)).toBe("2026-10-20");
    expect(requoteDueOn("2027-01-31", 45, TODAY)).toBe("2026-12-17");
    expect(requoteDueOn("2026-11-01", 45, TODAY)).toBe(TODAY);
    expect(requoteDueOn(TODAY, 45, TODAY)).toBe(TODAY);
    expect(requoteDueOn("2026-10-19", 45, TODAY)).toBeNull();
    expect(requoteDueOn("not a date", 45, TODAY)).toBeNull();
  });
});

describe("snooze", () => {
  it("3 days or a week, nothing else", () => {
    expect(snoozeUntil(TODAY, "3")).toBe("2026-10-23");
    expect(snoozeUntil(TODAY, "7")).toBe("2026-10-27");
    const id = "6f1d1c8e-3c2b-4f2a-9a51-0b7a9d6c1e11";
    expect(snoozeSchema.safeParse({ id, days: "3" }).success).toBe(true);
    expect(snoozeSchema.safeParse({ id, days: "30" }).success).toBe(false);
    expect(snoozeSchema.safeParse({ id: "x", days: "3" }).success).toBe(false);
  });
});

describe("nurture check-back date", () => {
  it("defaults to 30 days and offers 3 and 6 months or a picked date", () => {
    expect(DEFAULT_CHECK_BACK).toBe("30d");
    expect(CHECK_BACK_CHOICES.map((c) => c.value)).toEqual(["30d", "3m", "6m", "date"]);
    expect(checkBackDate(TODAY, "30d", null)).toEqual({ ok: true, date: "2026-11-19" });
    expect(checkBackDate(TODAY, "3m", null)).toEqual({ ok: true, date: "2027-01-20" });
    expect(checkBackDate("2026-08-31", "6m", null)).toEqual({ ok: true, date: "2027-02-28" });
    expect(checkBackDate(TODAY, "date", "2026-12-01")).toEqual({ ok: true, date: "2026-12-01" });
  });

  it("refuses a missing, past, far-off or unknown choice", () => {
    expect(checkBackDate(TODAY, "date", "")).toMatchObject({ ok: false });
    expect(checkBackDate(TODAY, "date", TODAY)).toEqual({ ok: false, message: "Pick a date after today." });
    expect(checkBackDate(TODAY, "date", "2029-01-01")).toEqual({ ok: false, message: "Pick a date within two years." });
    expect(checkBackDate(TODAY, "2y", null)).toMatchObject({ ok: false });
  });
});

describe("current coverage", () => {
  const id = "6f1d1c8e-3c2b-4f2a-9a51-0b7a9d6c1e11";
  it("accepts a carrier and date, or blanks (which clear them)", () => {
    expect(coverageSchema.parse({ id, current_carrier: " Example Mutual ", current_policy_renews_on: "2026-12-04" }))
      .toEqual({ id, current_carrier: "Example Mutual", current_policy_renews_on: "2026-12-04" });
    expect(coverageSchema.parse({ id, current_carrier: "", current_policy_renews_on: "" }))
      .toEqual({ id, current_carrier: null, current_policy_renews_on: null });
  });
  it("refuses a long carrier name or a bad date", () => {
    expect(coverageSchema.safeParse({ id, current_carrier: "x".repeat(101), current_policy_renews_on: "" }).success).toBe(false);
    expect(coverageSchema.safeParse({ id, current_carrier: "", current_policy_renews_on: "2026-02-30" }).success).toBe(false);
  });
});

describe("Focus rules in Settings", () => {
  const base = { action: "create_task" as const, day_count: "calendar" as const, completion_window_days: 0, cooldown_days: null };
  it("are described in plain English", () => {
    expect(describeRule({ ...base, trigger_event: "nurture_started", anchor: "requested_date", offset_days: 0 }))
      .toBe("When an opportunity is moved to nurture with a check-back date: a task due on the check-back date.");
    expect(describeRule({ ...base, trigger_event: "current_policy_renewal_known", anchor: "renewal_date", offset_days: -45 }))
      .toBe("When a prospect's current policy renewal date is entered (any deal not won): a task due 45 days before the renewal date.");
    expect(describeRule({ ...base, trigger_event: "referral_received", anchor: "event_date", offset_days: 0 }))
      .toBe("When a contact is linked to the person who referred them: a task due the same day.");
  });
});
