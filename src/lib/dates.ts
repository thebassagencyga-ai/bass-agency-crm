// Calendar-date helpers (ADR-007). "Today" is always computed in the user's time zone,
// never from the server's UTC clock.

export const DEFAULT_TIME_ZONE = "America/New_York";

/** Today's date as YYYY-MM-DD in the given time zone. */
export function todayInZone(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Formats a calendar date (YYYY-MM-DD) for display without any time-zone shift. */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Formats an instant (timestamptz) as a date in the user's time zone. */
export function formatInstantDate(iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium" }).format(date);
}

/** Adds whole days to a calendar date (YYYY-MM-DD). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Milliseconds the zone is ahead of UTC at the given instant (negative in the US). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * A wall-clock time typed in the user's zone ("2026-11-01T09:30", as from a
 * datetime-local input) → the instant as an ISO string. Returns null if unreadable.
 * In the repeated hour when clocks fall back, the first (daylight-time) occurrence is used;
 * a time skipped when clocks spring forward is moved an hour later.
 */
export function zonedLocalToIso(local: string, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  if (!isIsoDate(local.slice(0, 10)) || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const first = wall - zoneOffsetMs(wall, timeZone);
  const second = wall - zoneOffsetMs(first, timeZone);
  // Prefer the earlier instant when both readings map back to the same wall time.
  const candidates = [first, second].filter((ms) => isoToZonedLocal(new Date(ms).toISOString(), timeZone) === local);
  const ms = candidates.length > 0 ? Math.min(...candidates) : Math.max(first, second);
  return new Date(ms).toISOString();
}

/** An instant → "YYYY-MM-DDTHH:mm" in the user's zone, for a datetime-local input. */
export function isoToZonedLocal(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Formats an instant as date and time in the user's zone, e.g. "Oct 15, 2026, 9:30 AM". */
export function formatInstantDateTime(iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}
