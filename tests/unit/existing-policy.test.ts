import { describe, expect, it } from "vitest";
import { existingPolicyRow, existingPolicySchema, nextRenewal } from "@/lib/opportunities/existing-policy";

// ADR-042: a policy the client already has. Fictional data only.
const CONTACT = "00000000-0000-4000-8000-000000000001";
const STAGE = "00000000-0000-4000-8000-000000000002";
const base = { contact_id: CONTACT, product_line: "home", quoted_carrier: "", estimated_annual_premium: "", effective_date: "", renewal_date: "", policy_term_months: "", description: "" };

describe("nextRenewal", () => {
  it("keeps a renewal date that is today or later", () => {
    expect(nextRenewal(null, "2026-10-19", 12, "2026-10-19")).toBe("2026-10-19");
    expect(nextRenewal("2026-03-01", "2027-03-01", 12, "2026-10-19")).toBe("2027-03-01");
  });
  it("moves a passed renewal date forward by the term", () => {
    expect(nextRenewal(null, "2025-04-15", 12, "2026-10-19")).toBe("2027-04-15");
    expect(nextRenewal(null, "2025-04-15", 6, "2026-10-19")).toBe("2027-04-15");
    expect(nextRenewal(null, "2026-05-15", 6, "2026-10-19")).toBe("2026-11-15");
  });
  it("works out the renewal from the effective date when none is given", () => {
    expect(nextRenewal("2026-03-01", null, 12, "2026-10-19")).toBe("2027-03-01");
    expect(nextRenewal("2024-02-10", null, 12, "2026-10-19")).toBe("2027-02-10");
    expect(nextRenewal("2026-06-01", null, 6, "2026-10-19")).toBe("2026-12-01");
  });
  it("does not drift at month ends", () => {
    expect(nextRenewal(null, "2026-01-31", 6, "2026-10-19")).toBe("2027-01-31");
  });
  it("is null with no dates", () => {
    expect(nextRenewal(null, null, 12, "2026-10-19")).toBeNull();
  });
});

describe("existingPolicySchema", () => {
  it("needs the effective date or the renewal date", () => {
    const r = existingPolicySchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ["effective_date"], message: "Enter the effective date or the renewal date." });
  });
  it("accepts a past effective date and parses the premium", () => {
    const r = existingPolicySchema.safeParse({ ...base, effective_date: "2025-06-01", estimated_annual_premium: "$1,250.50", quoted_carrier: " Example Mutual " });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ effective_date: "2025-06-01", estimated_annual_premium: 1250.5, quoted_carrier: "Example Mutual", policy_term_months: 12 });
  });
  it("refuses a renewal on or before the effective date, a bad date and a bad amount", () => {
    const sameDay = existingPolicySchema.safeParse({ ...base, effective_date: "2026-06-01", renewal_date: "2026-06-01" });
    expect(sameDay.error?.issues.map((i) => i.path[0])).toEqual(["renewal_date"]);
    const badAmount = existingPolicySchema.safeParse({ ...base, effective_date: "2026-06-01", estimated_annual_premium: "abc" });
    expect(badAmount.error?.issues.map((i) => i.path[0])).toEqual(["estimated_annual_premium"]);
    expect(existingPolicySchema.safeParse({ ...base, effective_date: "2026-02-30" }).success).toBe(false);
  });
});

describe("existingPolicyRow", () => {
  it("is won at the Bound stage, marked existing, with the next renewal", () => {
    const data = existingPolicySchema.parse({ ...base, product_line: "auto", effective_date: "2025-05-15", policy_term_months: "6" });
    expect(existingPolicyRow(data, STAGE, "2026-10-19")).toEqual({
      contact_id: CONTACT, product_line: "auto", stage_id: STAGE, outcome: "won", existing_policy: true,
      quoted_carrier: null, estimated_annual_premium: null, effective_date: "2025-05-15", renewal_date: "2026-11-15",
      policy_term_months: 6, description: null,
    });
  });
  it("uses 12 months for lines other than auto", () => {
    const data = existingPolicySchema.parse({ ...base, effective_date: "2025-05-15", policy_term_months: "6" });
    expect(existingPolicyRow(data, STAGE, "2026-10-19")).toMatchObject({ policy_term_months: 12, renewal_date: "2027-05-15" });
  });
});
