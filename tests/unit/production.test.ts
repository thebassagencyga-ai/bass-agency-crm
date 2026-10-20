import { describe, expect, it } from "vitest";
import {
  RATE_ROWS, goalPercent, goalsSchema, lifeDetailsSchema, lifeInstalment, monthChoices, monthCommission, parseMonth,
  productionCsvRows, rateField, rateKey, yearPace, type ProductionReport,
} from "@/lib/production";

// Phase 28 (ADR-046): the page maths and form checks. The commission rules themselves are tested
// against the database in tests/db/production.test.ts.

const ID = "6f1d1c8e-3c2b-4f2a-9a51-0b7a9d6c1e11";

describe("life instalment preview (same rule as the database)", () => {
  it("your tracker's example: $3,200 Term, monthly, 45% = $120 a month from the first payout month", () => {
    expect(lifeInstalment({ premium: 3200, mode: "monthly", rate: 45, firstPayoutOn: "2026-11-07", effectiveDate: "2026-10-20" }))
      .toEqual({ amount: 120, perYear: 12, fromMonth: "2026-11-01" });
  });
  it("quarterly, twice a year and yearly; mode not set means monthly; effective date when no payout date", () => {
    expect(lifeInstalment({ premium: 2400, mode: "quarterly", rate: 50, firstPayoutOn: null, effectiveDate: "2026-10-01" })).toMatchObject({ amount: 300, perYear: 4, fromMonth: "2026-10-01" });
    expect(lifeInstalment({ premium: 2400, mode: "semiannual", rate: 50, firstPayoutOn: null, effectiveDate: null })).toMatchObject({ amount: 600, perYear: 2, fromMonth: null });
    expect(lifeInstalment({ premium: 2400, mode: "annual", rate: 50, firstPayoutOn: null, effectiveDate: null })!.amount).toBe(1200);
    expect(lifeInstalment({ premium: 1000, mode: null, rate: 10, firstPayoutOn: null, effectiveDate: null })!.amount).toBe(8.33);
  });
  it("nothing without a premium or a rate", () => {
    expect(lifeInstalment({ premium: null, mode: "monthly", rate: 45, firstPayoutOn: null, effectiveDate: null })).toBeNull();
    expect(lifeInstalment({ premium: 3200, mode: "monthly", rate: null, firstPayoutOn: null, effectiveDate: null })).toBeNull();
  });
});

describe("goals, pace and months", () => {
  it("percent of goal; none without a goal", () => {
    expect(goalPercent(14820, "20000")).toBe(74);
    expect(goalPercent(9, 12)).toBe(75);
    expect(goalPercent(5, null)).toBeNull();
    expect(goalPercent(5, 0)).toBeNull();
  });
  it("year-end pace from the months so far", () => {
    expect(yearPace(162400, "2026-10-01")).toBe(194880);
    expect(yearPace(1000, "2026-01-01")).toBe(12000);
  });
  it("month from ?month=YYYY-MM, else this month; 24 choices, newest first", () => {
    expect(parseMonth("2026-03", "2026-10-20")).toBe("2026-03-01");
    expect(parseMonth("2026-13", "2026-10-20")).toBe("2026-10-01");
    expect(parseMonth(undefined, "2026-10-20")).toBe("2026-10-01");
    const c = monthChoices("2026-10-20");
    expect(c).toHaveLength(24);
    expect([c[0], c[1], c[23]]).toEqual(["2026-10-01", "2026-09-01", "2024-11-01"]);
  });
});

describe("forms", () => {
  it("rates: 0–100, up to two decimals, % allowed, blank = not set", () => {
    expect(rateField.parse("45")).toBe(45);
    expect(rateField.parse("12.5%")).toBe(12.5);
    expect(rateField.parse("")).toBeNull();
    for (const bad of ["101", "-1", "abc", "1.234"]) expect(rateField.safeParse(bad).success).toBe(false);
  });
  it("one rate pair per line and per life type", () => {
    expect(RATE_ROWS.map((r) => rateKey(r.line, r.type, "new"))).toEqual([
      "rate_auto_new", "rate_home_new", "rate_commercial_new", "rate_life_term_new", "rate_life_whole_new",
      "rate_life_universal_new", "rate_life_indexed_universal_new", "rate_life_final_expense_new",
    ]);
  });
  it("goals: money with $ and commas, whole policies, all optional", () => {
    expect(goalsSchema.parse({ premium_per_month: "$20,000", policies_per_month: "12", premium_per_year: "" }))
      .toEqual({ premium_per_month: 20000, policies_per_month: 12, premium_per_year: null });
    expect(goalsSchema.safeParse({ premium_per_month: "", policies_per_month: "1.5", premium_per_year: "" }).success).toBe(false);
  });
  it("life details: known types and modes only", () => {
    expect(lifeDetailsSchema.parse({ id: ID, life_policy_type: "term", premium_mode: "monthly", first_payout_on: "2026-11-07", commission_rate_override: "" }))
      .toEqual({ id: ID, life_policy_type: "term", premium_mode: "monthly", first_payout_on: "2026-11-07", commission_rate_override: null });
    expect(lifeDetailsSchema.safeParse({ id: ID, life_policy_type: "variable", premium_mode: "", first_payout_on: "", commission_rate_override: "" }).success).toBe(false);
    expect(lifeDetailsSchema.safeParse({ id: ID, life_policy_type: "", premium_mode: "weekly", first_payout_on: "", commission_rate_override: "" }).success).toBe(false);
  });
});

describe("report totals and CSV", () => {
  const r: ProductionReport = {
    month: "2026-10-01", rates_set: true, goals: null,
    written: { policies: 2, premium: "4200", without_premium: 0 }, ytd: { policies: 2, premium: "4200" },
    by_line: [
      { product_line: "auto", policies: 1, premium: "1000", new_rate: "15", commission_new: "150", renewals: 1, renewal_premium: "2000", renewal_rate: "10", commission_renewal: "200" },
      { product_line: "life", policies: 1, premium: "3200", new_rate: null, commission_new: "120", renewals: null, renewal_premium: null, renewal_rate: null, commission_renewal: "0" },
    ],
    forecast: [{ month: "2026-10-01", renewals: "200", life: "120", new_business: "150" }],
    active_policies: 2, ended_this_month: 0, life_without_type: 0,
  };
  it("month commission adds new business, renewals and life", () => {
    expect(monthCommission(r)).toEqual({ newBusiness: 270, renewals: 200, total: 470 });
  });
  it("CSV rows: by line, then the next 12 months", () => {
    const rows = productionCsvRows(r, (l) => l.toUpperCase());
    expect(rows[0]).toEqual({ section: "October 2026 new business", item: "AUTO", policies: 1, premium: 1000, commission: 150 });
    expect(rows[1]).toEqual({ section: "October 2026 renewals", item: "AUTO", policies: 1, premium: 2000, commission: 200 });
    expect(rows.at(-1)).toEqual({ section: "Next 12 months", item: "October 2026", policies: "", premium: "", commission: 470 });
  });
});
