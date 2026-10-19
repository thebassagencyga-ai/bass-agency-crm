// What a Leads row and a Clients (book) row show (Phase 24, ADR-040). Pure; unit tested. The data
// comes from read-only queries over the visible page of contacts (src/lib/contacts/list-extras.ts).
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";

export interface LeadDealInput {
  contact_id: string;
  product_line: ProductLine;
  stage_id: string;
  outcome: "open" | "nurture";
  quote_sent_on: string | null;
}
export interface OpenTaskInput { contact_id: string; title: string; due_date: string }

export interface LeadSummary {
  deals: { line: ProductLine; stage: string; nurture: boolean; quoteSentOn: string | null }[];
  nextTask: { title: string; due: string; overdue: boolean } | null;
}

export function leadSummaries(
  deals: readonly LeadDealInput[],
  stageNames: ReadonlyMap<string, string>,
  tasks: readonly OpenTaskInput[],
  today: string,
): Map<string, LeadSummary> {
  const out = new Map<string, LeadSummary>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { deals: [], nextTask: null }));
    return s;
  };
  for (const d of deals) {
    get(d.contact_id).deals.push({
      line: d.product_line, stage: stageNames.get(d.stage_id) ?? "", nurture: d.outcome === "nurture", quoteSentOn: d.quote_sent_on,
    });
  }
  for (const s of out.values()) s.deals.sort((a, b) => PRODUCT_LINES.indexOf(a.line) - PRODUCT_LINES.indexOf(b.line));
  for (const t of tasks) {
    const s = get(t.contact_id);
    if (!s.nextTask || t.due_date < s.nextTask.due) s.nextTask = { title: t.title, due: t.due_date, overdue: t.due_date < today };
  }
  return out;
}

export interface PolicyInput {
  contact_id: string;
  product_line: ProductLine;
  estimated_annual_premium: number | string | null;
  renewal_date: string | null;
}
export interface GapInput { contact_id: string; lacks_line: ProductLine }

export interface BookSummary {
  lines: ProductLine[];
  /** Sum of the premiums recorded on active policies; null when none is recorded. */
  premium: number | null;
  /** False when at least one active policy has no premium recorded (the sum is a floor). */
  premiumComplete: boolean;
  /** Soonest renewal on an active policy (past due included). */
  nextRenewal: string | null;
  gaps: ProductLine[];
}

export function bookSummaries(policies: readonly PolicyInput[], gaps: readonly GapInput[]): Map<string, BookSummary> {
  const out = new Map<string, BookSummary>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { lines: [], premium: null, premiumComplete: true, nextRenewal: null, gaps: [] }));
    return s;
  };
  for (const p of policies) {
    const s = get(p.contact_id);
    if (!s.lines.includes(p.product_line)) s.lines.push(p.product_line);
    const premium = p.estimated_annual_premium === null ? null : Number(p.estimated_annual_premium);
    if (premium === null || !Number.isFinite(premium)) s.premiumComplete = false;
    else s.premium = Math.round(((s.premium ?? 0) + premium) * 100) / 100;
    if (p.renewal_date && (!s.nextRenewal || p.renewal_date < s.nextRenewal)) s.nextRenewal = p.renewal_date;
  }
  for (const g of gaps) {
    const s = get(g.contact_id);
    if (!s.gaps.includes(g.lacks_line)) s.gaps.push(g.lacks_line);
  }
  const order = (l: ProductLine) => PRODUCT_LINES.indexOf(l);
  for (const s of out.values()) {
    s.lines.sort((a, b) => order(a) - order(b));
    s.gaps.sort((a, b) => order(a) - order(b));
  }
  return out;
}
