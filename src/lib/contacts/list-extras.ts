import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductLine } from "@/lib/pipelines";
import { bookSummaries, leadSummaries, type GapInput, type LeadDealInput, type OpenTaskInput, type PolicyInput } from "./summaries";
import type { ContactTab } from "./tabs";

// Read-only extras for the Leads and Clients tabs (Phase 24, ADR-040): only for the contacts on
// the current page, through the signed-in user's client (RLS applies). Nothing is written.

export async function tabCounts(supabase: SupabaseClient): Promise<Record<ContactTab, number>> {
  const count = async (status: string | null) => {
    let q = supabase.from("contacts").select("id", { count: "exact", head: true }).is("archived_at", null).is("merged_into_contact_id", null);
    if (status) q = q.eq("relationship_status", status);
    const { count: n, error } = await q;
    if (error) throw new Error(`Could not count contacts (${error.code ?? "unknown"}).`);
    return n ?? 0;
  };
  const [leads, clients, former, all] = await Promise.all([count("prospect"), count("client"), count("former_client"), count(null)]);
  return { leads, clients, former, all };
}

export async function loadLeadSummaries(supabase: SupabaseClient, ids: string[], stageNames: Map<string, string>, today: string) {
  if (ids.length === 0) return new Map();
  const [deals, tasks] = await Promise.all([
    supabase.from("opportunities").select("contact_id, product_line, stage_id, outcome, quote_sent_on")
      .in("contact_id", ids).in("outcome", ["open", "nurture"]).limit(500),
    supabase.from("tasks").select("contact_id, title, due_date")
      .in("contact_id", ids).eq("status", "open").order("due_date").limit(500),
  ]);
  if (deals.error || tasks.error) throw new Error("Could not load lead details.");
  return leadSummaries((deals.data ?? []) as LeadDealInput[], stageNames, (tasks.data ?? []) as OpenTaskInput[], today);
}

export async function loadBookSummaries(supabase: SupabaseClient, ids: string[], today: string) {
  if (ids.length === 0) return new Map();
  const policies = supabase.from("opportunities").select("contact_id, product_line, estimated_annual_premium, renewal_date")
    .in("contact_id", ids).eq("outcome", "won").is("policy_ended_on", null).limit(1000);
  // Cross-sell gaps: the shared matcher, read in pages of 200 (its maximum) so no client is missed.
  const gaps: GapInput[] = [];
  const wanted = new Set(ids);
  for (let offset = 0; offset < 1000; offset += 200) {
    const { data, error } = await supabase.rpc("cross_sell_prompts", { p_today: today, p_contact_id: null, p_limit: 200, p_offset: offset });
    if (error) throw new Error(`Could not load cross-sell gaps (${error.code ?? "unknown"}).`);
    const rows = (data ?? []) as { contact_id: string; lacks_line: ProductLine }[];
    for (const r of rows) if (wanted.has(r.contact_id)) gaps.push(r);
    if (rows.length < 200) break;
  }
  const { data, error } = await policies;
  if (error) throw new Error(`Could not load policies (${error.code ?? "unknown"}).`);
  return bookSummaries((data ?? []) as PolicyInput[], gaps);
}
