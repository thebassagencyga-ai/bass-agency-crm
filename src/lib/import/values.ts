// Reading the values in a report row (Phase 15). Pure and unit tested.
import { isIsoDate } from "@/lib/dates";

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** "GA", "ga", "Georgia" → "GA"; anything else → null. */
export function parseState(raw: string): string | null {
  const s = raw.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATES[s.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** 2026-03-01, 3/1/2026, 03-01-2026, 3/1/26 → "2026-03-01"; "" → null; anything else → undefined (invalid). */
export function parseDate(raw: string): string | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += y < 70 ? 2000 : 1900;
  } else return undefined;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(iso) && y >= 1900 && y <= 2100 ? iso : undefined;
}

/** "$1,234.50" → 1234.5; "" → null; negative, huge or not a number → undefined. */
export function parseMoney(raw: string): number | null | undefined {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  return n < 10_000_000 ? n : undefined;
}

/** "6", "6 months", "semi-annual" → 6; "12", "annual" → 12; "" → null; else undefined. */
export function parseTerm(raw: string): 6 | 12 | null | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (/^0?6(\s*(mo|mos|month|months))?$/.test(s) || /semi|six/.test(s)) return 6;
  if (/^12(\s*(mo|mos|month|months))?$/.test(s) || /^(annual|yearly|1\s*y(ea)?r?)$/.test(s)) return 12;
  return undefined;
}

const BUSINESS = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pc|pllc|church|farms?|ministries|associates|enterprises|group|holdings|services|trust)\b\.?/i;

/** Splits an "Insured Name" cell: "Example, Robin" or "Robin A Example"; businesses stay whole. */
export function splitName(raw: string): { business_name: string } | { first_name: string | null; last_name: string | null } {
  const s = raw.trim().replace(/\s+/g, " ");
  if (BUSINESS.test(s)) return { business_name: s };
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((p) => p.trim());
    return { first_name: first || null, last_name: last || null };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { first_name: null, last_name: parts[0] || null };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] ?? null };
}
