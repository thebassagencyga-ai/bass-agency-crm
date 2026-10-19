// iCalendar (RFC 5545) feed of open tasks (Phase 18, ADR-034). Each task is an all-day event
// on its due date. Pure functions, unit tested in tests/unit/calendar.test.ts.

export interface FeedTask {
  task_id: string;
  title: string;
  due_date: string; // YYYY-MM-DD
  priority: "low" | "normal" | "high";
  contact_name: string | null;
  updated_at: string;
}

/** Escapes TEXT values: backslash, semicolon, comma and line breaks (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets (UTF-8), continuing with CRLF + space, never splitting a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");

/** The day after an ISO date (all-day events end on the next day, exclusive). */
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** UTC timestamp in iCalendar form, e.g. 20261017T120000Z. */
export function utcStamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The event title: "task — client". */
export function eventSummary(task: Pick<FeedTask, "title" | "contact_name">): string {
  const name = task.contact_name?.trim();
  return name ? `${task.title} — ${name}` : task.title;
}

export function buildCalendar(tasks: readonly FeedTask[], opts: { appUrl: string; now: Date; host: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Producr CRM//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Producr tasks",
    "X-WR-TIMEZONE:America/New_York",
    // Ask calendar apps to check back hourly (many decide for themselves).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const stamp = utcStamp(opts.now);
  for (const t of tasks) {
    const url = `${opts.appUrl.replace(/\/$/, "")}/tasks/${t.task_id}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.task_id}@${opts.host}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${utcStamp(new Date(t.updated_at))}`,
      `DTSTART;VALUE=DATE:${compactDate(t.due_date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(t.due_date))}`,
      `SUMMARY:${escapeText(eventSummary(t))}`,
      `DESCRIPTION:${escapeText(`Open in the CRM: ${url}`)}`,
      `URL:${url}`,
      `PRIORITY:${t.priority === "high" ? 1 : t.priority === "low" ? 9 : 5}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
