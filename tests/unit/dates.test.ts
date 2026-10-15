import { describe, expect, it } from "vitest";
import { addDays, formatInstantDateTime, isIsoDate, isoToZonedLocal, todayInZone, zonedLocalToIso } from "@/lib/dates";

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

describe("Phase 5 date helpers", () => {
  const NY = "America/New_York";

  it("today flips exactly at midnight New York time, not UTC", () => {
    expect(todayInZone(NY, new Date("2026-10-16T03:59:59Z"))).toBe("2026-10-15"); // 11:59:59 PM EDT
    expect(todayInZone(NY, new Date("2026-10-16T04:00:00Z"))).toBe("2026-10-16"); // 12:00 AM EDT
    expect(todayInZone(NY, new Date("2026-12-16T04:59:59Z"))).toBe("2026-12-15"); // 11:59:59 PM EST
    expect(todayInZone(NY, new Date("2026-12-16T05:00:00Z"))).toBe("2026-12-16");
  });

  it("today is right on both daylight-saving change days", () => {
    // 2026-03-08: clocks spring forward at 2 AM. 2026-11-01: clocks fall back at 2 AM.
    expect(todayInZone(NY, new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07");
    expect(todayInZone(NY, new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(todayInZone(NY, new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(todayInZone(NY, new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(todayInZone(NY, new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01"); // 11:59 PM EST
  });

  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-15", 30)).toBe("2026-11-14");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("converts a typed New York time to the right instant in summer and winter", () => {
    expect(zonedLocalToIso("2026-10-15T09:30", NY)).toBe("2026-10-15T13:30:00.000Z");
    expect(zonedLocalToIso("2026-12-15T09:30", NY)).toBe("2026-12-15T14:30:00.000Z");
    expect(zonedLocalToIso("2026-10-15T23:59", NY)).toBe("2026-10-16T03:59:00.000Z");
  });

  it("handles the hour that repeats and the hour that is skipped", () => {
    expect(zonedLocalToIso("2026-11-01T01:30", NY)).toBe("2026-11-01T05:30:00.000Z"); // first 1:30 (EDT)
    expect(zonedLocalToIso("2026-03-08T02:30", NY)).toBe("2026-03-08T07:30:00.000Z"); // no 2:30 → 3:30 EDT
  });

  it("round-trips for the datetime input and rejects nonsense", () => {
    expect(isoToZonedLocal("2026-10-15T13:30:00.000Z", NY)).toBe("2026-10-15T09:30");
    expect(isoToZonedLocal(zonedLocalToIso("2026-07-04T18:05", NY)!, NY)).toBe("2026-07-04T18:05");
    expect(zonedLocalToIso("2026-02-30T09:00", NY)).toBeNull();
    expect(zonedLocalToIso("yesterday", NY)).toBeNull();
    expect(formatInstantDateTime("2026-10-15T13:30:00.000Z", NY)).toBe("Oct 15, 2026, 9:30 AM");
  });
});
