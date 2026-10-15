import { describe, expect, it } from "vitest";
import { DEFINITIONS, conversionRate, formatConversion, num, parsePeriod, periodRange, premiumNote, sumBy } from "@/lib/reports";

// Phase 9: report periods and calculations (no database). Figures are tested in tests/db.

describe("periodRange", () => {
  it.each([
    ["this_month", "2026-10-15", "2026-10-01", "2026-10-15"],
    ["last_month", "2026-10-15", "2026-09-01", "2026-09-30"],
    ["last_month", "2026-03-31", "2026-02-01", "2026-02-28"],
    ["last_month", "2026-01-10", "2025-12-01", "2025-12-31"],
    ["this_quarter", "2026-10-15", "2026-10-01", "2026-10-15"],
    ["this_quarter", "2026-06-30", "2026-04-01", "2026-06-30"],
    ["this_quarter", "2026-02-14", "2026-01-01", "2026-02-14"],
    ["year_to_date", "2026-10-15", "2026-01-01", "2026-10-15"],
    ["last_12_months", "2026-10-15", "2025-10-16", "2026-10-15"],
    ["last_12_months", "2028-02-29", "2027-03-01", "2028-02-29"],
  ] as const)("%s on %s → %s to %s", (key, today, start, end) => {
    expect(periodRange(key, today)).toEqual({ key, start, end });
  });

  it("reads ?period=, defaulting to this month", () => {
    expect(parsePeriod({ period: "last_month" })).toBe("last_month");
    expect(parsePeriod({ period: "forever" })).toBe("this_month");
    expect(parsePeriod({})).toBe("this_month");
  });
});

describe("conversion", () => {
  it("is won ÷ (won + lost), with the denominator shown", () => {
    expect(conversionRate(1, 1)).toBe(0.5);
    expect(formatConversion(1, 2)).toBe("33% (1 of 3 closed)");
    expect(formatConversion(2, 1)).toBe("67% (2 of 3 closed)");
    expect(formatConversion(3, 0)).toBe("100% (3 of 3 closed)");
  });
  it("has no rate when nothing closed", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(formatConversion(0, 0)).toBe("— (none closed)");
  });
});

describe("numbers from the Data API", () => {
  it("reads numeric strings and totals them", () => {
    expect([num("12"), num(3), num(null), num("")]).toEqual([12, 3, 0, 0]);
    expect(sumBy([{ n: "2" }, { n: 3 }, { n: null }], (r) => r.n)).toBe(5);
  });
  it("notes when only some records have a premium", () => {
    expect(premiumNote(2, 2)).toBe("");
    expect(premiumNote(1, 3)).toBe(" (1 of 3 have a premium recorded)");
  });
});

describe("definitions", () => {
  it("every report has a written definition; none mention commission as a figure", () => {
    expect(Object.keys(DEFINITIONS).sort()).toEqual(
      ["asks", "conversion", "cross_sell", "new_leads", "open_pipeline", "quotes", "referrals", "renewals", "tasks"],
    );
    for (const text of Object.values(DEFINITIONS)) {
      expect(text.length).toBeGreaterThan(40);
      expect(text.toLowerCase()).not.toContain("commission");
    }
  });
});
