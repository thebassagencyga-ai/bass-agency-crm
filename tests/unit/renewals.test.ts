import { describe, expect, it } from "vitest";
import { addMonths } from "@/lib/dates";
import { opportunityDetailsSchema, termForLine } from "@/lib/opportunities";
import { groupRenewals, parseRenewalParams, renewalOutcomeSchema, renewalsHref, termLabel, type RenewalRow } from "@/lib/renewals";

// Phase 8: renewals view logic and the retention-outcome form (no database).

const UUID = "3f1c8e0a-6b2d-4c4e-9a1f-2b3c4d5e6f70";

describe("addMonths (matches Postgres date + interval)", () => {
  it.each([
    ["2026-01-15", 6, "2026-07-15"],
    ["2026-07-15", 6, "2027-01-15"],
    ["2026-03-01", 12, "2027-03-01"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2027-08-31", 6, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-01-31", 1, "2026-02-28"],
  ])("%s + %i months = %s", (from, months, expected) => {
    expect(addMonths(from, months)).toBe(expected);
  });
});

describe("parseRenewalParams", () => {
  it("defaults to the next 60 days, all lines", () => {
    expect(parseRenewalParams({})).toEqual({ days: 60, line: null });
  });
  it("accepts 30 / 60 / 90 and a product line", () => {
    expect(parseRenewalParams({ days: "90", line: "home" })).toEqual({ days: 90, line: "home" });
    expect(parseRenewalParams({ days: "30" })).toEqual({ days: 30, line: null });
  });
  it("ignores anything else", () => {
    expect(parseRenewalParams({ days: "45", line: "aircraft" })).toEqual({ days: 60, line: null });
    expect(parseRenewalParams({ days: ["90", "30"], line: ["auto"] })).toEqual({ days: 90, line: "auto" });
  });
  it("builds links that keep the other filter", () => {
    expect(renewalsHref({ days: 30, line: "auto" }, { days: 90 })).toBe("/renewals?days=90&line=auto");
    expect(renewalsHref({ days: 30, line: "auto" }, { line: null })).toBe("/renewals?days=30");
  });
});

describe("groupRenewals", () => {
  const row = (id: string, outcome: RenewalRow["outcome"], renewal_date: string): RenewalRow => ({
    id, contact_id: UUID, product_line: "auto", outcome, renewal_date, policy_term_months: 12,
    estimated_annual_premium: null, quoted_carrier: null, review_task_id: null, review_due_date: null,
    contact_type: "individual", first_name: "Pat", last_name: "Example", business_name: null, phone: null,
  });
  it("splits past-due policies, upcoming policies and prospects, keeping order", () => {
    const g = groupRenewals(
      [row("a", "won", "2026-10-01"), row("b", "open", "2026-10-20"), row("c", "won", "2026-10-15"), row("d", "nurture", "2026-11-01"), row("e", "won", "2026-12-01")],
      "2026-10-15",
    );
    expect(g.pastDue.map((r) => r.id)).toEqual(["a"]);
    expect(g.policies.map((r) => r.id)).toEqual(["c", "e"]);
    expect(g.prospects.map((r) => r.id)).toEqual(["b", "d"]);
  });
  it("labels the term", () => {
    expect([termLabel(6), termLabel(12)]).toEqual(["Renews every 6 months", "Renews yearly"]);
  });
});

describe("renewalOutcomeSchema", () => {
  const base = { opportunity_id: UUID, loss_reason: "", premium: "", notes: "" };
  it("renewed with a new premium", () => {
    expect(renewalOutcomeSchema.parse({ ...base, outcome: "renewed", premium: "$1,350.50", notes: " kept coverage " })).toEqual({
      opportunity_id: UUID, outcome: "renewed", loss_reason: null, premium: 1350.5, notes: "kept coverage",
    });
  });
  it("re-marketed without a premium keeps the current estimate (null)", () => {
    expect(renewalOutcomeSchema.parse({ ...base, outcome: "remarketed" }).premium).toBeNull();
  });
  it("lost requires a reason and ignores any premium", () => {
    const missing = renewalOutcomeSchema.safeParse({ ...base, outcome: "lost" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(["loss_reason"]);
    expect(renewalOutcomeSchema.parse({ ...base, outcome: "lost", loss_reason: "price", premium: "900" })).toEqual(
      expect.objectContaining({ loss_reason: "price", premium: null }),
    );
  });
  it("a reason given with renewed is dropped", () => {
    expect(renewalOutcomeSchema.parse({ ...base, outcome: "renewed", loss_reason: "price" }).loss_reason).toBeNull();
  });
  it.each([
    [{ outcome: "" }, "outcome"],
    [{ outcome: "cancelled" }, "outcome"],
    [{ outcome: "renewed", premium: "abc" }, "premium"],
    [{ outcome: "renewed", premium: "-5" }, "premium"],
    [{ outcome: "renewed", notes: "x".repeat(1001) }, "notes"],
    [{ outcome: "renewed", opportunity_id: "nope" }, "opportunity_id"],
  ])("rejects %j", (override, field) => {
    const r = renewalOutcomeSchema.safeParse({ ...base, ...override });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe("policy term on opportunities", () => {
  const details = { description: "", quoted_carrier: "", quote_sent_on: "", estimated_annual_premium: "", next_action: "", effective_date: "", renewal_date: "" };
  it("defaults to 12 months and accepts 6", () => {
    expect(opportunityDetailsSchema.parse(details).policy_term_months).toBe(12);
    expect(opportunityDetailsSchema.parse({ ...details, policy_term_months: "6" }).policy_term_months).toBe(6);
  });
  it("rejects other terms", () => {
    expect(opportunityDetailsSchema.safeParse({ ...details, policy_term_months: "3" }).success).toBe(false);
  });
  it("only auto keeps a 6-month term", () => {
    expect(termForLine({ policy_term_months: 6 as const }, "auto").policy_term_months).toBe(6);
    expect(termForLine({ policy_term_months: 6 as const }, "home").policy_term_months).toBe(12);
  });
});
