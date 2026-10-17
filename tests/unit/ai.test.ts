import { describe, expect, it } from "vitest";
import { checkBudget, costUsd, monthStart, worstCaseUsd } from "@/lib/ai/budget";
import { aiEnabled, monthlyBudgetUsd } from "@/lib/ai/config";
import { findSensitive } from "@/lib/ai/guard";
import {
  briefingRequest, checkBriefing, checkDraft, checkImport, checkNotes, draftRequest, importRequest, notesInput, notesRequest,
} from "@/lib/ai/jobs";

describe("config", () => {
  it("is off without a real-looking key", () => {
    expect(aiEnabled(undefined)).toBe(false);
    expect(aiEnabled("")).toBe(false);
    expect(aiEnabled("short")).toBe(false);
    expect(aiEnabled("sk-ant-" + "x".repeat(40))).toBe(true);
  });

  it("caps the monthly budget at $10; the setting may only lower it", () => {
    expect(monthlyBudgetUsd(undefined)).toBe(10);
    expect(monthlyBudgetUsd("")).toBe(10);
    expect(monthlyBudgetUsd("5")).toBe(5);
    expect(monthlyBudgetUsd("50")).toBe(10);
    expect(monthlyBudgetUsd("-1")).toBe(0);
    expect(monthlyBudgetUsd("ten")).toBe(0);
  });
});

describe("budget", () => {
  it("prices calls conservatively and rounds up", () => {
    expect(costUsd(1_000_000, 0)).toBe(5);
    expect(costUsd(0, 1_000_000)).toBe(25);
    expect(costUsd(1, 0)).toBe(0.000005);
    expect(costUsd(1000, 500)).toBe(0.0175);
    expect(worstCaseUsd(3000, 2000)).toBe(costUsd(1500, 2000));
  });

  it("refuses a call that could go over the cap", () => {
    expect(checkBudget(9.9, 0.05, 10)).toEqual({ ok: true });
    expect(checkBudget(9.97, 0.05, 10)).toEqual({ ok: false, reason: "spent" });
    expect(checkBudget(0, 0.01, 0)).toEqual({ ok: false, reason: "off" });
  });

  it("the month starts at midnight New York time, across daylight saving", () => {
    expect(monthStart(new Date("2026-10-17T12:00:00Z"))).toBe("2026-10-01T04:00:00.000Z"); // EDT
    expect(monthStart(new Date("2026-12-15T12:00:00Z"))).toBe("2026-12-01T05:00:00.000Z"); // EST
    expect(monthStart(new Date("2026-11-01T03:30:00Z"))).toBe("2026-10-01T04:00:00.000Z"); // still Oct 31 in NY
  });
});

describe("sensitive-data guard", () => {
  it.each([
    ["her ssn is 000-12-3456", "a Social Security number"],
    ["SSN on file", "a Social Security number"],
    ["123456789", "a Social Security number"],
    ["card 4111 1111 1111 1111 exp 12/28", "a card or bank account number"],
    ["routing number 061000052", "a Social Security number"],
    ["account # for autopay", "a bank account number"],
    ["drivers license number GA12345678", "a driver's license number"],
    ["DL# 058123456", "a Social Security number"],
    ["she has a diagnosis of diabetes", "health information"],
  ])("%s → %s", (text, what) => expect(findSensitive(text)).toBe(what));

  it.each(["called 404-555-0101, wants auto quote by 11/20", "renews 2026-12-01, premium $1,250.00", "policy for 2 cars, 2019 and 2021"])(
    "lets ordinary notes through: %s", (text) => expect(findSensitive(text)).toBeNull());
});

describe("jobs send only what they list", () => {
  it("draft: first name, agent, line, renewal, current text, instruction — nothing else", () => {
    const req = draftRequest({
      purpose: "Renewal check-in", first_name: "Robin", agent_name: "Sam Example", line: "auto", renewal_date: "on Mar 1, 2027",
      current_text: "Hi Robin…", instruction: "mention bundling", channel: "text",
    });
    expect(JSON.parse(req.user)).toEqual({
      purpose: "Renewal check-in", client_first_name: "Robin", agent_name: "Sam Example", insurance_line: "auto",
      renewal: "on Mar 1, 2027", current_draft: "Hi Robin…", agent_instruction: "mention bundling",
    });
    expect(req.system).toContain("text message");
    expect(req.job).toBe("draft_message");
  });

  it("draft check trims to the channel's size and drops a subject on texts", () => {
    expect(checkDraft({ subject: "Hello", body: " x".repeat(400) }, "text")).toEqual({ subject: "", body: " x".repeat(400).trim().slice(0, 640) });
    expect(checkDraft({ subject: " Your renewal ", body: "Hi" }, "email")).toEqual({ subject: "Your renewal", body: "Hi" });
    expect(checkDraft({ subject: "", body: "  " }, "text")).toBeNull();
  });

  it("notes: only the notes and today's date; follow-up dates in the past or far future are dropped", () => {
    const input = notesInput.parse({ notes: "Called Robin, wants a quote, call back Thursday", today: "2026-10-17" });
    expect(JSON.parse(notesRequest(input).user)).toEqual({ today: "2026-10-17", notes: input.notes });
    expect(notesInput.safeParse({ notes: "hi", today: "2026-10-17" }).success).toBe(false);
    const base = { activity_type: "call" as const, outcome: null, summary: " Called. " };
    expect(checkNotes({ ...base, follow_up_date: "2026-10-22" }, "2026-10-17")).toEqual({
      activity_type: "call", outcome: "requested_follow_up", requested_follow_up_on: "2026-10-22", notes: "Called.",
    });
    expect(checkNotes({ ...base, follow_up_date: "2026-10-01" }, "2026-10-17").requested_follow_up_on).toBeNull();
    expect(checkNotes({ ...base, follow_up_date: "2030-01-01" }, "2026-10-17").requested_follow_up_on).toBeNull();
    expect(checkNotes({ ...base, follow_up_date: "next week" }, "2026-10-17").requested_follow_up_on).toBeNull();
  });

  it("briefing: task titles, first names, dates; at most 40 tasks and 20 renewals; at most 5 priorities back", () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({ title: `Task ${i}`, first_name: "Robin", due: "2026-10-17", priority: "normal" }));
    const req = briefingRequest({ today: "2026-10-17", tasks, renewals: [], new_requests: 2 });
    const sent = JSON.parse(req.user);
    expect(sent.tasks).toHaveLength(40);
    expect(Object.keys(sent.tasks[0])).toEqual(["title", "first_name", "due", "priority"]);
    expect(checkBriefing({ summary: " Busy day. ", priorities: ["a", "", "b", "c", "d", "e", "f"] })).toEqual({ summary: "Busy day.", priorities: ["a", "b", "c", "d", "e"] });
  });

  it("import: headings and policy types only; a column is used once; unknown values ignored", () => {
    const input = { headers: ["Insured Name", "Policy Type", "Eff Date"], policy_types: ["PAP", "Boat"] };
    const req = importRequest(input);
    expect(JSON.parse(req.user).columns).toEqual([{ index: 0, heading: "Insured Name" }, { index: 1, heading: "Policy Type" }, { index: 2, heading: "Eff Date" }]);
    expect(checkImport({
      columns: [
        { field: "full_name", column: 0 }, { field: "first_name", column: 0 }, { field: "line", column: 1 },
        { field: "effective_date", column: 2 }, { field: "carrier", column: 9 }, { field: "email", column: null },
      ],
      policy_types: [{ value: "PAP", line: "auto" }, { value: "Boat", line: "skip" }, { value: "Made up", line: "home" }],
    }, input)).toEqual({ mapping: { full_name: 0, line: 1, effective_date: 2 }, lines: { PAP: "auto", Boat: "skip" } });
  });
});
