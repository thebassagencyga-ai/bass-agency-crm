import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/contacts/data";
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";
import { BOARD_LIMIT, OPPORTUNITIES_PAGE_SIZE, type OpportunityListParams } from "./params";
import type { Opportunity, OpportunityListRow, Pipeline, Stage } from "./types";

// Reads go through the signed-in user's Supabase client, so RLS decides what is visible.

const STAGE_COLUMNS = "id, pipeline_id, name, position, kind, is_quote_stage, archived_at";

/** All the agent's stages, removed ones included (old deals may sit in them). Phase 25. */
export async function getStages(supabase: SupabaseClient): Promise<Stage[]> {
  const { data, error } = await supabase.from("stages").select(STAGE_COLUMNS).order("position");
  if (error) throw new Error(`Could not load pipeline stages (${error.code ?? "unknown"}).`);
  return (data ?? []) as Stage[];
}

/** The agent's pipelines in use, in order, each with its current stages and the lines it receives. */
export async function getPipelines(supabase: SupabaseClient): Promise<Pipeline[]> {
  const [pipelines, stages, routes] = await Promise.all([
    supabase.from("pipelines").select("id, name, position").is("archived_at", null).order("position").order("created_at"),
    supabase.from("stages").select(STAGE_COLUMNS).is("archived_at", null).order("position"),
    supabase.from("pipeline_routes").select("product_line, pipeline_id"),
  ]);
  const error = pipelines.error ?? stages.error ?? routes.error;
  if (error) throw new Error(`Could not load pipelines (${error.code ?? "unknown"}).`);
  const allStages = (stages.data ?? []) as Stage[];
  const allRoutes = (routes.data ?? []) as { product_line: ProductLine; pipeline_id: string }[];
  return ((pipelines.data ?? []) as { id: string; name: string; position: number }[]).map((p) => ({
    ...p,
    stages: allStages.filter((s) => s.pipeline_id === p.id),
    lines: PRODUCT_LINES.filter((l) => allRoutes.some((r) => r.product_line === l && r.pipeline_id === p.id)),
  }));
}

/** The pipeline a line's new leads go to (its route, else the first pipeline). */
export const routedPipeline = (pipelines: Pipeline[], line: ProductLine): Pipeline | undefined =>
  pipelines.find((p) => p.lines.includes(line)) ?? pipelines[0];

export const stagesFor = (stages: Stage[], pipelineId: string) => stages.filter((s) => s.pipeline_id === pipelineId);

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
    p_pipeline_id: p.pipeline,
  });
  if (error) throw new Error(`Could not load opportunities (${error.code ?? "unknown"}).`);
  const rows = (data ?? []) as OpportunityListRow[];
  return { rows: rows.slice(0, OPPORTUNITIES_PAGE_SIZE), hasMore: rows.length > OPPORTUNITIES_PAGE_SIZE };
}

/** Board: everything being worked in one pipeline, plus won/lost in the last 30 days. */
export async function listBoard(supabase: SupabaseClient, pipelineId: string, q: string) {
  const { data, error } = await supabase.rpc("search_opportunities", {
    p_query: q,
    p_product_line: null,
    p_pipeline_id: pipelineId,
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
