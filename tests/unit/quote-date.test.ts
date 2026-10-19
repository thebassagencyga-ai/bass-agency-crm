import { describe, expect, it } from "vitest";
import { resolveQuoteDate, suggestedQuoteDate } from "@/lib/opportunities/quote-date";

// Phase 23 (ADR-039): the quote date suggested and saved when moving into a quote stage.
const today = "2026-10-19";

describe("suggestedQuoteDate", () => {
  it("is today when no quote date is recorded", () => {
    expect(suggestedQuoteDate({ existing: null, reopening: false, today })).toBe(today);
  });
  it("keeps a date already recorded in this round", () => {
    expect(suggestedQuoteDate({ existing: "2026-10-15", reopening: false, today })).toBe("2026-10-15");
  });
  it("starts from today when a won or lost opportunity is reopened (a new round)", () => {
    expect(suggestedQuoteDate({ existing: "2026-03-02", reopening: true, today })).toBe(today);
  });
});

describe("resolveQuoteDate", () => {
  it("uses the suggestion when the field is blank", () => {
    expect(resolveQuoteDate("", "2026-10-15", today)).toEqual({ ok: true, date: "2026-10-15" });
    expect(resolveQuoteDate(null, today, today)).toEqual({ ok: true, date: today });
  });
  it("accepts the agent's own past or current date", () => {
    expect(resolveQuoteDate("2026-10-17", today, today)).toEqual({ ok: true, date: "2026-10-17" });
    expect(resolveQuoteDate(today, "2026-10-01", today)).toEqual({ ok: true, date: today });
  });
  it("refuses future and invalid dates", () => {
    expect(resolveQuoteDate("2026-10-20", today, today)).toMatchObject({ ok: false });
    expect(resolveQuoteDate("2026-02-30", today, today)).toMatchObject({ ok: false });
    expect(resolveQuoteDate("next week", today, today)).toMatchObject({ ok: false });
  });
});
