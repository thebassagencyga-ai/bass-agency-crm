import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFullSession } from "@/lib/auth/require";
import { contactDisplayName } from "@/lib/contacts/format";
import type { Contact } from "@/lib/contacts/types";
import { isoToZonedLocal, todayInZone } from "@/lib/dates";
import { toCsv } from "@/lib/import/csv";
import { EXPORT_DATASETS, isExportDataset } from "@/lib/import/export";

// "Download my data" (Phase 15): one CSV per dataset, the signed-in user's own rows only (RLS).

type Row = Record<string, unknown>;

async function fetchAll(supabase: SupabaseClient, table: string, select: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).order("created_at").order("id").range(from, from + 999);
    if (error) throw new Error(`Could not export ${table} (${error.code ?? "unknown"}).`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

const instant = (v: unknown) => (typeof v === "string" ? isoToZonedLocal(v).replace("T", " ") : v);

export async function GET(_request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  if (!isExportDataset(dataset)) return new Response("Not found", { status: 404 });
  const { supabase } = await requireFullSession();
  const def = EXPORT_DATASETS[dataset];

  const contacts = await fetchAll(supabase, "contacts", EXPORT_DATASETS.contacts.select);
  const names = new Map(contacts.map((c) => [c.id as string, contactDisplayName(c as unknown as Contact)]));
  const source = dataset === "contacts" ? contacts : await fetchAll(supabase, def.table, def.select);
  const rows = source.map((r) => ({
    ...r,
    name: dataset === "contacts" ? names.get(r.id as string) : undefined,
    contact: names.get(r.contact_id as string) ?? "",
    referred_by: r.referred_by_contact_id ? names.get(r.referred_by_contact_id as string) ?? "" : "",
    archived: r.archived_at ? "yes" : "",
    tag_list: Array.isArray(r.tags) ? (r.tags as string[]).join(", ") : "",
    merged_into: r.merged_into_contact_id ? names.get(r.merged_into_contact_id as string) ?? "" : "",
    created_at: instant(r.created_at), closed_at: instant(r.closed_at), completed_at: instant(r.completed_at), occurred_at: instant(r.occurred_at),
  }));

  return new Response(toCsv(def.columns, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="producr-${dataset}-${todayInZone()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
