import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, eventSummary, foldLine, nextDay, utcStamp, type FeedTask } from "@/lib/calendar/ics";

const task: FeedTask = {
  task_id: "11111111-2222-3333-4444-555555555555", title: "Call; quote, renewal", due_date: "2026-12-31",
  priority: "high", contact_name: "Robin Example", updated_at: "2026-10-17T12:00:00.000Z",
};

describe("ics helpers", () => {
  it("escapes text and drops control characters", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\u0007")).toBe("a\\\\b\;c\\,d\\ne\\nf");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n ");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.join("")).toBe(line);
    expect(foldLine("SHORT")).toBe("SHORT");
  });

  it("dates, stamps and titles", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-03-08")).toBe("2026-03-09"); // DST change in New York: all-day dates ignore it
    expect(utcStamp(new Date("2026-10-17T12:34:56.789Z"))).toBe("20261017T123456Z");
    expect(eventSummary(task)).toBe("Call; quote, renewal — Robin Example");
    expect(eventSummary({ title: "Admin", contact_name: null })).toBe("Admin");
  });
});

describe("buildCalendar", () => {
  it("writes one all-day event per task with CRLF line ends", () => {
    const ics = buildCalendar([task], { appUrl: "https://crm.example.com/", now: new Date("2026-10-17T12:00:00Z"), host: "crm.example.com" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ics).toContain("UID:task-11111111-2222-3333-4444-555555555555@crm.example.com");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("SUMMARY:Call\; quote\\, renewal — Robin Example");
    expect(ics).toContain("URL:https://crm.example.com/tasks/11111111-2222-3333-4444-555555555555");
    expect(ics).toContain("PRIORITY:1");
    expect(ics).toContain("DTSTAMP:20261017T120000Z");
  });

  it("an empty feed is still a valid calendar", () => {
    const ics = buildCalendar([], { appUrl: "https://crm.example.com", now: new Date(), host: "crm.example.com" });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
