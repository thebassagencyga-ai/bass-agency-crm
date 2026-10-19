// Parses the opportunities page's URL parameters. Invalid values fall back to defaults so a
// hand-edited URL never breaks the page.
import { OPPORTUNITY_OUTCOMES, PRODUCT_LINES, type OpportunityOutcome, type ProductLine } from "@/lib/pipelines";

export const OPPORTUNITY_SORTS = ["updated", "created", "name", "premium", "renewal"] as const;
export const OPPORTUNITIES_PAGE_SIZE = 25;
/** Cards loaded per board; the board shows a "see all in the table" link beyond this. */
export const BOARD_LIMIT = 200;

export interface OpportunityListParams {
  view: "board" | "table";
  /** Phase 25: the pipeline shown on the board, or a table filter. Null: the board picks one. */
  pipeline: string | null;
  /** Table filter; on the board, an old ?line= link opens the pipeline that line routes to. */
  line: ProductLine | null;
  q: string;
  outcome: OpportunityOutcome | null;
  closed: "all" | "none";
  sort: (typeof OPPORTUNITY_SORTS)[number];
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function parseOpportunityListParams(raw: Raw): OpportunityListParams {
  const view = first(raw.view) === "table" ? "table" : "board";
  const page = Number.parseInt(first(raw.page), 10);
  const line = oneOf(first(raw.line), PRODUCT_LINES);
  const pipeline = first(raw.pipeline);
  return {
    view,
    pipeline: UUID.test(pipeline) ? pipeline.toLowerCase() : null,
    line,
    q: first(raw.q).trim().slice(0, 100),
    outcome: oneOf(first(raw.outcome), OPPORTUNITY_OUTCOMES),
    closed: first(raw.closed) === "none" ? "none" : "all",
    sort: oneOf(first(raw.sort), OPPORTUNITY_SORTS) ?? "updated",
    page: Number.isFinite(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}
