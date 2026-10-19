import type { Metadata } from "next";
import Link from "next/link";
import { OutcomeBadge } from "@/components/opportunities/badges";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import { formatDateOnly } from "@/lib/dates";
import { getStages, listBoard, listOpportunities, stagesFor } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { parseOpportunityListParams, type OpportunityListParams } from "@/lib/opportunities/params";
import { OUTCOME_LABELS, type OpportunityListRow, type Stage } from "@/lib/opportunities/types";
import { OPPORTUNITY_OUTCOMES, PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";
import { moveFromBoard } from "./actions";

export const metadata: Metadata = { title: "Opportunities · Producr CRM" };

const CONTROL =
  "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  moved: { text: "Stage updated.", tone: "ok" },
  won: { text: "Marked as won.", tone: "ok" },
  error: { text: "That move didn't work. Please try again.", tone: "error" },
};

function tableHref(p: OpportunityListParams, page: number): string {
  const qs = new URLSearchParams({ view: "table" });
  if (p.q) qs.set("q", p.q);
  if (p.line) qs.set("line", p.line);
  if (p.outcome) qs.set("outcome", p.outcome);
  if (p.closed !== "all") qs.set("closed", p.closed);
  if (p.sort !== "updated") qs.set("sort", p.sort);
  if (page > 1) qs.set("page", String(page));
  return `/opportunities?${qs.toString()}`;
}

const rowName = (r: OpportunityListRow) => contactDisplayName(r);

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = parseOpportunityListParams(raw);
  const { supabase } = await requireFullSession();
  const noticeKey = Object.keys(NOTICES).find((k) => raw[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;

  return (
    <section className="flex flex-col gap-4">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`max-w-4xl rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
          {notice.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
        <nav aria-label="View" className="flex gap-1">
          {(["board", "table"] as const).map((v) => (
            <Link
              key={v}
              href={v === "board" ? `/opportunities?line=${params.line ?? "auto"}` : "/opportunities?view=table"}
              aria-current={params.view === v ? "page" : undefined}
              className="flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-on-brand"
            >
              {v === "board" ? "Board" : "Table"}
            </Link>
          ))}
        </nav>
      </div>
      <p className="max-w-4xl text-sm text-muted">
        Add an opportunity from a contact&apos;s page. {params.view === "board" ? "The board shows open and nurture opportunities plus anything won or lost in the last 30 days." : null}
      </p>
      {params.view === "board" ? (
        <Board line={params.line ?? "auto"} q={params.q} supabaseStages={await getStages(supabase)} rows={await listBoard(supabase, params.line ?? "auto", params.q)} />
      ) : (
        <Table params={params} result={await listOpportunities(supabase, params)} />
      )}
    </section>
  );
}

function Board({ line, q, supabaseStages, rows }: { line: ProductLine; q: string; supabaseStages: Stage[]; rows: { rows: OpportunityListRow[]; truncated: boolean } }) {
  const stages = stagesFor(supabaseStages, line);
  return (
    <>
      <nav aria-label="Product line" className="flex flex-wrap gap-1">
        {PRODUCT_LINES.map((l) => (
          <Link
            key={l}
            href={`/opportunities?line=${l}`}
            aria-current={l === line ? "page" : undefined}
            className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium underline-offset-4 aria-[current=page]:bg-brand-soft aria-[current=page]:underline"
          >
            {PRODUCT_LINE_NAMES[l]}
          </Link>
        ))}
      </nav>
      <form method="get" action="/opportunities" role="search" className="flex max-w-xl gap-2">
        <input type="hidden" name="line" value={line} />
        <label htmlFor="board-q" className="sr-only">Search this pipeline</label>
        <input id="board-q" name="q" type="search" defaultValue={q} placeholder="Search name, description or carrier" maxLength={100} className={`${CONTROL} flex-1`} />
        <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Search</button>
      </form>
      {rows.truncated ? (
        <p className="text-sm">Showing the 200 most recently updated. <Link href={`/opportunities?view=table&line=${line}`} className="underline text-link">See all in the table</Link>.</p>
      ) : null}
      {/* Phones: one stage after another. Wider screens: stages side by side, scrolling sideways. */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:overflow-x-auto md:pb-2">
        {stages.map((stage) => {
          const cards = rows.rows.filter((r) => r.stage_id === stage.id);
          const headingId = `stage-${stage.id}`;
          return (
            <section key={stage.id} aria-labelledby={headingId} className="flex flex-col gap-2 rounded-md bg-subtle p-2 md:w-72 md:shrink-0">
              <h2 id={headingId} className="px-1 text-sm font-semibold">
                {stage.name} <span className="font-normal text-muted">({cards.length})</span>
              </h2>
              {cards.length === 0 ? (
                <p className="px-1 text-sm text-muted">None</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {cards.map((r) => (
                    <li key={r.id} id={`opp-${r.id}`} className="flex flex-col gap-2 rounded-md border border-line bg-card p-3">
                      <Link href={`/opportunities/${r.id}`} className="flex min-h-11 items-center font-medium underline-offset-2 hover:underline">{rowName(r)}</Link>
                      {r.description ? <p className="text-sm break-words text-muted">{r.description}</p> : null}
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {r.outcome !== "open" ? <OutcomeBadge outcome={r.outcome} /> : null}
                        {r.estimated_annual_premium !== null ? <span>{formatMoney(r.estimated_annual_premium, { whole: true })}/yr</span> : null}
                      </div>
                      {r.next_action ? <p className="text-sm break-words">Next: {r.next_action}</p> : null}
                      {r.outcome === "won" || r.outcome === "lost" ? null : (
                        <form action={moveFromBoard} className="flex gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="q" value={q} />
                          <label htmlFor={`move-${r.id}`} className="sr-only">Move {rowName(r)} to stage</label>
                          <select id={`move-${r.id}`} name="stage_id" defaultValue="" className={`${CONTROL} flex-1 text-sm`}>
                            <option value="" disabled>Move to…</option>
                            {stages.filter((s) => s.id !== stage.id).map((s) => (
                              <option key={s.id} value={s.id}>{s.kind === "won" ? `${s.name} (won)` : s.kind === "lost" ? `${s.name}…` : s.name}</option>
                            ))}
                          </select>
                          <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-3 text-sm font-medium">Move</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Table({ params, result }: { params: OpportunityListParams; result: { rows: OpportunityListRow[]; hasMore: boolean } }) {
  const filtered = Boolean(params.q || params.line || params.outcome || params.closed !== "all");
  return (
    <>
      <form method="get" action="/opportunities" role="search" className="flex max-w-4xl flex-col gap-2 rounded-md border border-line p-3 bg-card">
        <input type="hidden" name="view" value="table" />
        <label htmlFor="q" className="text-sm font-medium">Search</label>
        <div className="flex gap-2">
          <input id="q" name="q" type="search" defaultValue={params.q} placeholder="Name, business, description or carrier" maxLength={100} className={`${CONTROL} flex-1`} />
          <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Search</button>
        </div>
        <details open={filtered && !params.q}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Filters and sorting</summary>
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">Product line
              <select name="line" defaultValue={params.line ?? ""} className={CONTROL}>
                <option value="">All</option>
                {PRODUCT_LINES.map((l) => <option key={l} value={l}>{PRODUCT_LINE_NAMES[l]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Outcome
              <select name="outcome" defaultValue={params.outcome ?? ""} className={CONTROL}>
                <option value="">All</option>
                {OPPORTUNITY_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Show
              <select name="closed" defaultValue={params.closed} className={CONTROL}>
                <option value="all">Open and closed</option>
                <option value="none">Open and nurture only</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Sort by
              <select name="sort" defaultValue={params.sort} className={CONTROL}>
                <option value="updated">Recently updated</option>
                <option value="created">Newest</option>
                <option value="name">Name</option>
                <option value="premium">Premium (highest)</option>
                <option value="renewal">Renewal date</option>
              </select>
            </label>
          </div>
          <button type="submit" className="mt-2 min-h-11 rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Apply</button>
        </details>
      </form>

      {result.rows.length === 0 ? (
        <p className="text-muted">
          {filtered ? "No opportunities match. Try a different search or clear the filters." : "No opportunities yet. Open a contact and choose “Add opportunity”."}
        </p>
      ) : (
        <ul aria-label="Opportunities" className="flex max-w-4xl flex-col divide-y divide-line rounded-md border border-line bg-card">
          {result.rows.map((r) => (
            <li key={r.id}>
              <Link href={`/opportunities/${r.id}`} className="flex min-h-11 flex-col gap-1 p-3 hover:bg-subtle sm:flex-row sm:items-center sm:gap-4">
                <span className="font-medium sm:w-56 sm:shrink-0">{rowName(r)}</span>
                <span className="text-sm sm:w-28 sm:shrink-0">{PRODUCT_LINE_NAMES[r.product_line]}</span>
                <span className="text-sm sm:w-40 sm:shrink-0">{r.stage_name}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <OutcomeBadge outcome={r.outcome} />
                  {r.estimated_annual_premium !== null ? <span>{formatMoney(r.estimated_annual_premium, { whole: true })}/yr</span> : null}
                  {r.renewal_date ? <span>Renews {formatDateOnly(r.renewal_date)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {params.page > 1 || result.hasMore ? (
        <nav aria-label="Pages" className="flex max-w-4xl justify-between">
          {params.page > 1 ? <Link href={tableHref(params, params.page - 1)} className="min-h-11 py-2 underline text-link">← Previous</Link> : <span />}
          {result.hasMore ? <Link href={tableHref(params, params.page + 1)} className="min-h-11 py-2 underline text-link">Next →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
