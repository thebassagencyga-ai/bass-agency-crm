import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/contacts/data";
import type { ProductLine } from "@/lib/pipelines";
import { BOARD_LIMIT, OPPORTUNITIES_PAGE_SIZE, type OpportunityListParams } from "./params";
import type { Opportunity, OpportunityListRow, Stage } from "./types";

// Reads go through the signed-in user's Supabase client, so RLS decides what is visible.

/** All pipeline stages, ordered by product line then position. Reference data. */
export async function getStages(supabase: SupabaseClient): Promise<Stage[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, product_line, code, name, position, kind, is_quote_stage")
    .order("product_line")
    .order("position");
  if (error) throw new Error(`Could not load pipeline stages (${error.code ?? "unknown"}).`);
  return (data ?? []) as Stage[];
}

export const stagesFor = (stages: Stage[], line: ProductLine) => stages.filter((s) => s.product_line === line);

export async function listOpportunities(supabase: SupabaseClient, p: OpportunityListParams) {
  const { data, error } = await supabase.rpc("search_opportunities", {
    p_query: p.q,
    p_product_line: p.line,
    p_outcome: p.outcome,
    p_stage_id: null,
    p_closed: p.closed,
    p_sort: p.sort,
    p_limit: OPPORTUNITIES_PAGE_SIZE + 1,
    p_offset: (p.page - 1) * OPPORTUNITIES_PAGE_SIZE,
  });
  if (error) throw new Error(`Could not load opportunities (${error.code ?? "unknown"}).`);
  const rows = (data ?? []) as OpportunityListRow[];
  return { rows: rows.slice(0, OPPORTUNITIES_PAGE_SIZE), hasMore: rows.length > OPPORTUNITIES_PAGE_SIZE };
}

/** Board: everything being worked in one pipeline, plus won/lost in the last 30 days. */
export async function listBoard(supabase: SupabaseClient, line: ProductLine, q: string) {
  const { data, error } = await supabase.rpc("search_opportunities", {
    p_query: q,
    p_product_line: line,
    p_outcome: null,
    p_stage_id: null,
    p_closed: "recent",
    p_sort: "updated",
    p_limit: BOARD_LIMIT + 1,
    p_offset: 0,
  });
  if (error) throw new Error(`Could not load the board (${error.code ?? "unknown"}).`);
  const rows = (data ?? []) as OpportunityListRow[];
  return { rows: rows.slice(0, BOARD_LIMIT), truncated: rows.length > BOARD_LIMIT };
}

export async function getOpportunity(supabase: SupabaseClient, id: string): Promise<Opportunity | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the opportunity (${error.code ?? "unknown"}).`);
  return (data as Opportunity | null) ?? null;
}

/** A contact's opportunities, newest first, for the contact page. */
export async function listForContact(supabase: SupabaseClient, contactId: string): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load opportunities (${error.code ?? "unknown"}).`);
  return (data ?? []) as Opportunity[];
}

/**
 * Which of these contacts are clients (Phase 24): open deals for them are account rounding, not
 * new business, and get a "Client" tag on the pipeline.
 */
export async function clientIdsAmong(supabase: SupabaseClient, contactIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(contactIds)];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.from("contacts").select("id").in("id", ids).eq("relationship_status", "client");
  if (error) throw new Error(`Could not load contact statuses (${error.code ?? "unknown"}).`);
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}
