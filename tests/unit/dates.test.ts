import { describe, expect, it } from "vitest";
import { isIsoDate, todayInZone } from "@/lib/dates";

describe("todayInZone", () => {
  it("uses Eastern time, not UTC, around midnight", () => {
    // 03:30 UTC on Oct 15 is 11:30 PM on Oct 14 in New York (EDT, UTC-4).
    expect(todayInZone("America/New_York", new Date("2026-10-15T03:30:00Z"))).toBe("2026-10-14");
    expect(todayInZone("America/New_York", new Date("2026-10-15T04:30:00Z"))).toBe("2026-10-15");
  });

  it("handles the switch to standard time (EST, UTC-5)", () => {
    expect(todayInZone("America/New_York", new Date("2026-12-01T04:30:00Z"))).toBe("2026-11-30");
  });
});

describe("isIsoDate", () => {
  it.each([["2026-10-20", true], ["2028-02-29", true], ["2026-02-30", false], ["2026-13-01", false], ["10/20/2026", false], ["", false]])(
    "%j → %s",
    (value, expected) => {
      expect(isIsoDate(value)).toBe(expected);
    },
  );
});

describe("display formatting", () => {
  it("shows a calendar date exactly as stored, with no time-zone shift", async () => {
    const { formatDateOnly } = await import("@/lib/dates");
    expect(formatDateOnly("2026-10-20")).toBe("Oct 20, 2026");
    expect(formatDateOnly("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDateOnly("bad")).toBe("");
    expect(formatDateOnly(null)).toBe("");
  });

  it("shows an instant as the Eastern-time date", async () => {
    const { formatInstantDate } = await import("@/lib/dates");
    expect(formatInstantDate("2026-10-15T03:30:00Z")).toBe("Oct 14, 2026");
    expect(formatInstantDate("not a date")).toBe("");
  });
});
