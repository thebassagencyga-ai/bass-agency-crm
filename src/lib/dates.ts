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
