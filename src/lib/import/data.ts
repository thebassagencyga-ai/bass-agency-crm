import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ImportBatch {
  id: string;
  file_name: string;
  contacts_created: number;
  contacts_matched: number;
  policies_created: number;
  status: "done" | "undone";
  created_at: string;
  /** Within the 7-day undo window (the database checks again). */
  undoable: boolean;
}

export async function listImports(supabase: SupabaseClient, now: Date = new Date()): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from("import_batches").select("id, file_name, contacts_created, contacts_matched, policies_created, status, created_at")
    .order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(`Could not load imports (${error.code ?? "unknown"}).`);
  const cutoff = now.getTime() - 7 * 24 * 3600 * 1000;
  return ((data ?? []) as Omit<ImportBatch, "undoable">[]).map((b) => ({
    ...b, undoable: b.status === "done" && new Date(b.created_at).getTime() > cutoff,
  }));
}
