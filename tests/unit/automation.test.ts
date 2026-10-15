import { describe, expect, it } from "vitest";
import { INCENTIVE_WORDS, describeRule, ruleFormSchema } from "@/lib/automation";

const base = { action: "create_task" as const, anchor: "event_date" as const, offset_days: 0, day_count: "calendar" as const, completion_window_days: 0, cooldown_days: null };

describe("describeRule", () => {
  it.each([
    [{ ...base, trigger_event: "opportunity_created" }, "When a new opportunity starts at its pipeline's first stage: a task due the same day."],
    [{ ...base, trigger_event: "initial_contact_no_quote", offset_days: 2, day_count: "business" as const }, "When the first-contact task is completed and no quote has been sent: a task due 2 business days later."],
    [{ ...base, trigger_event: "quote_sent", offset_days: 3 }, "When a quote-sent date is entered: a task due 3 days later."],
    [{ ...base, trigger_event: "follow_up_requested", anchor: "requested_date" as const }, "When you log that the prospect asked for a follow-up on a date: a task due on the date they asked for."],
    [{ ...base, trigger_event: "renewal_date_known", anchor: "renewal_date" as const, offset_days: -60 }, "When a renewal date is entered: a task due 60 days before the renewal date."],
    [{ ...base, trigger_event: "opportunity_won", action: "close_prospecting_tasks" as const }, "When an opportunity is won: its open prospecting tasks are closed."],
    [{ ...base, trigger_event: "opportunity_won", offset_days: 1, completion_window_days: 30, cooldown_days: 365 }, "When an opportunity is won: a task starts 1 day later, due 30 days after that. Not repeated for the same contact within 365 days."],
    [{ ...base, trigger_event: "opportunity_won", action: "create_checklist" as const }, "When an opportunity is won: checklist tasks due the same day."],
  ])("%j", (rule, text) => {
    expect(describeRule(rule)).toBe(text);
  });
});

describe("rule form validation", () => {
  it("parses a typical edit", () => {
    const r = ruleFormSchema.safeParse({ enabled: "on", days: "5", day_count: "business", task_title_template: " Call back ", task_priority: "high" });
    expect(r.success && r.data).toMatchObject({ enabled: true, days: 5, day_count: "business", task_title_template: "Call back", task_priority: "high" });
  });

  it("an unticked box means disabled", () => {
    const r = ruleFormSchema.safeParse({});
    expect(r.success && r.data.enabled).toBe(false);
  });

  it.each([
    [{ days: "-1" }, "days"],
    [{ days: "400" }, "days"],
    [{ days: "2.5" }, "days"],
    [{ task_title_template: "  " }, "task_title_template"],
    [{ items: "\n \n" }, "items"],
    [{ cooldown_days: "0" }, "cooldown_days"],
  ])("rejects %j", (input, field) => {
    const r = ruleFormSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it("splits checklist items by line", () => {
    const r = ruleFormSchema.safeParse({ items: "Thank the client\n\n Send welcome packet \n" });
    expect(r.success && r.data.items).toEqual(["Thank the client", "Send welcome packet"]);
  });

  it("refuses messages that offer an incentive (Google review policy, ADR-013)", () => {
    for (const text of ["Leave a review for a $10 gift card", "Get a discount on your next policy", "Enter our drawing", "Free coffee for a review"]) {
      expect(ruleFormSchema.safeParse({ message_template: text }).success).toBe(false);
    }
    expect(ruleFormSchema.safeParse({ message_template: "Hi {first_name}, would you share a review? {review_link}" }).success).toBe(true);
    expect(INCENTIVE_WORDS.test("Thanks for choosing The Bass Agency")).toBe(false);
  });
});
