/** "$1,234.50" / "1234.5" / "1,234" → 1234.5. Returns null for blank, NaN for anything unreadable. */
export function parseMoney(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Number(t);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Postgres numeric arrives as a string through the Data API; accepts either. */
export function formatMoney(value: number | string | null | undefined, opts: { whole?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  return (opts.whole ? usdWhole : usd).format(n);
}
