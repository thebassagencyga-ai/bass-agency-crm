// Parses the opportunities page's URL parameters. Invalid values fall back to defaults so a
// hand-edited URL never breaks the page.
import { OPPORTUNITY_OUTCOMES, PRODUCT_LINES, type OpportunityOutcome, type ProductLine } from "@/lib/pipelines";

export const OPPORTUNITY_SORTS = ["updated", "created", "name", "premium", "renewal"] as const;
export const OPPORTUNITIES_PAGE_SIZE = 25;
/** Cards loaded per board; the board shows a "see all in the table" link beyond this. */
export const BOARD_LIMIT = 200;

export interface OpportunityListParams {
  view: "board" | "table";
  line: ProductLine | null;
  q: string;
  outcome: OpportunityOutcome | null;
  closed: "all" | "none";
  sort: (typeof OPPORTUNITY_SORTS)[number];
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function parseOpportunityListParams(raw: Raw): OpportunityListParams {
  const view = first(raw.view) === "table" ? "table" : "board";
  const page = Number.parseInt(first(raw.page), 10);
  const line = oneOf(first(raw.line), PRODUCT_LINES);
  return {
    view,
    // The board always shows one pipeline; the table may show all.
    line: view === "board" ? (line ?? "auto") : line,
    q: first(raw.q).trim().slice(0, 100),
    outcome: oneOf(first(raw.outcome), OPPORTUNITY_OUTCOMES),
    closed: first(raw.closed) === "none" ? "none" : "all",
    sort: oneOf(first(raw.sort), OPPORTUNITY_SORTS) ?? "updated",
    page: Number.isFinite(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}
