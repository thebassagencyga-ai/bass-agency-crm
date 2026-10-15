import { describe, expect, it } from "vitest";
import { activitySchema } from "@/lib/activities";
import { todayInZone } from "@/lib/dates";
import {
  messageRuleFor, newTaskSchema, notStartedYet, parseTaskListParams, renderMessage, smsHref, taskFormSchema, taskView,
} from "@/lib/tasks";

const UUID = "3f1c8e0a-6b2d-4c4e-9a1f-2b3c4d5e6f70";

describe("taskView (which tab a task is on)", () => {
  const today = "2026-10-15";
  it.each([
    [{ status: "open", due_date: "2026-10-14" }, "overdue"],
    [{ status: "open", due_date: "2026-10-15" }, "today"],
    [{ status: "open", due_date: "2026-10-16" }, "upcoming"],
    [{ status: "completed", due_date: "2026-10-01" }, "done"],
    [{ status: "cancelled", due_date: "2026-10-30" }, "done"],
  ] as const)("%j → %s", (task, view) => {
    expect(taskView(task, today)).toBe(view);
  });

  it("a review request created at 11:59 PM moves from upcoming to today at midnight New York time", () => {
    const task = { status: "open" as const, due_date: "2026-10-16", start_date: "2026-10-16" };
    const before = todayInZone("America/New_York", new Date("2026-10-16T03:59:00Z")); // 11:59 PM Oct 15
    const after = todayInZone("America/New_York", new Date("2026-10-16T04:00:00Z")); // 12:00 AM Oct 16
    expect([taskView(task, before), notStartedYet(task, before)]).toEqual(["upcoming", true]);
    expect([taskView(task, after), notStartedYet(task, after)]).toEqual(["today", false]);
  });
});

describe("review and referral messages", () => {
  const template = "Hi {first_name}, would you leave a review? {review_link} - {agent_name}";

  it("fills the placeholders", () => {
    expect(renderMessage(template, { first_name: "Avery", agent_name: "Rich", review_link: "https://g.page/r/example" }))
      .toBe("Hi Avery, would you leave a review? https://g.page/r/example - Rich");
  });

  it("uses friendly fallbacks when something is missing", () => {
    expect(renderMessage(template, { first_name: null, agent_name: " ", review_link: null }))
      .toBe("Hi there, would you leave a review? [add your Google review link in Settings] - The Bass Agency");
  });

  it("builds an sms: link the phone's Messages app understands", () => {
    expect(smsHref("770-555-0142", "Hi & thanks!")).toBe("sms:+17705550142?&body=Hi%20%26%20thanks!");
    expect(smsHref("+1 (770) 555-0142", "x")).toBe("sms:+17705550142?&body=x");
    expect(smsHref("555-0142", "x")).toBeNull();
    expect(smsHref(null, "x")).toBeNull();
  });

  it("only review and referral tasks have a message", () => {
    expect(messageRuleFor("review_request")).toBe("review_request");
    expect(messageRuleFor("referral_request")).toBe("referral_request");
    expect(messageRuleFor("prospecting")).toBeNull();
  });
});

describe("task validation", () => {
  const ok = { title: "Call back", description: "", due_date: "2026-10-20", start_date: "", priority: "", category: "", opportunity_id: "" };

  it("accepts a minimal task with defaults", () => {
    const r = taskFormSchema.safeParse(ok);
    expect(r.success && r.data).toEqual({
      title: "Call back", description: null, due_date: "2026-10-20", start_date: null, priority: "normal", category: "other", opportunity_id: null,
    });
  });

  it.each([
    ["missing title", { title: "  " }, "title"],
    ["missing due date", { due_date: "" }, "due_date"],
    ["impossible date", { due_date: "2026-02-30" }, "due_date"],
    ["start after due", { start_date: "2026-10-21" }, "start_date"],
    ["unknown priority", { priority: "urgent" }, "priority"],
    ["title too long", { title: "x".repeat(201) }, "title"],
  ])("rejects %s", (_label, override, field) => {
    const r = taskFormSchema.safeParse({ ...ok, ...override });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it("a new task needs a contact", () => {
    expect(newTaskSchema.safeParse(ok).success).toBe(false);
    expect(newTaskSchema.safeParse({ ...ok, contact_id: UUID }).success).toBe(true);
  });
});

describe("activity validation", () => {
  const now = () => new Date("2026-10-15T18:00:00Z"); // 2:00 PM in New York
  const schema = activitySchema("America/New_York", now);
  const ok = { activity_type: "call", occurred_at: "2026-10-15T09:30", outcome: "", requested_follow_up_on: "", notes: "", opportunity_id: "", task_id: "" };

  it("converts the typed New York time to an instant", () => {
    const r = schema.safeParse(ok);
    expect(r.success && r.data.occurred_at).toBe("2026-10-15T13:30:00.000Z");
  });

  it("refuses a time in the future", () => {
    expect(schema.safeParse({ ...ok, occurred_at: "2026-10-15T15:00" }).success).toBe(false);
  });

  it("requires the follow-up date exactly when the outcome asks for one", () => {
    expect(schema.safeParse({ ...ok, outcome: "requested_follow_up" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, outcome: "requested_follow_up", requested_follow_up_on: "2026-11-01" }).success).toBe(true);
    expect(schema.safeParse({ ...ok, outcome: "connected", requested_follow_up_on: "2026-11-01" }).success).toBe(false);
  });

  it("rejects an unknown type or outcome", () => {
    expect(schema.safeParse({ ...ok, activity_type: "fax" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, outcome: "ecstatic" }).success).toBe(false);
  });
});

describe("parseTaskListParams", () => {
  it("defaults to today and ignores bad values", () => {
    expect(parseTaskListParams({ view: "someday", line: "boat", priority: "urgent", page: "0" })).toEqual({
      view: "today", line: null, priority: null, category: null, page: 1,
    });
    expect(parseTaskListParams({ view: "overdue", line: "life", priority: "high", category: "renewal", page: "2" })).toEqual({
      view: "overdue", line: "life", priority: "high", category: "renewal", page: 2,
    });
  });
});
