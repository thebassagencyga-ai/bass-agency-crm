import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";
import { RENEWAL_WINDOWS, type RenewalWindow } from "./types";

export interface RenewalParams {
  days: RenewalWindow;
  line: ProductLine | null;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads ?days=30|60|90 (default 60) and ?line=… from the URL; anything else falls back. */
export function parseRenewalParams(query: Record<string, string | string[] | undefined>): RenewalParams {
  const days = Number(first(query.days));
  const line = first(query.line);
  return {
    days: (RENEWAL_WINDOWS as readonly number[]).includes(days) ? (days as RenewalWindow) : 60,
    line: (PRODUCT_LINES as readonly string[]).includes(line ?? "") ? (line as ProductLine) : null,
  };
}

export function renewalsHref(params: RenewalParams, change: Partial<RenewalParams> = {}): string {
  const next = { ...params, ...change };
  const q = new URLSearchParams({ days: String(next.days) });
  if (next.line) q.set("line", next.line);
  return `/renewals?${q.toString()}`;
}
