"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import type { Contact } from "@/lib/contacts/types";
import { matchExisting, type ExistingContact, type ImportClient } from "@/lib/import/build";
import { importPayloadSchema, type ImportPayload } from "@/lib/import/schema";

// Import and undo (Phase 15, ADR-031). Re-checked on the server; the import runs as the
// signed-in user in one database transaction (public.import_book).

/** Existing contacts with the same email or phone as clients in the file. */
export async function findImportMatches(clients: Pick<ImportClient, "key" | "contact">[]): Promise<Record<string, { id: string; label: string }>> {
  const { supabase } = await requireFullSession();
  const existing: ExistingContact[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("contacts").select("id, contact_type, first_name, last_name, business_name, email, phone")
      .is("archived_at", null).order("id").range(from, from + 999);
    if (error) throw new Error("Could not check for existing contacts.");
    for (const c of (data ?? []) as Contact[]) existing.push({ id: c.id, label: contactDisplayName(c), email: c.email, phone: c.phone });
    if (!data || data.length < 1000) break;
  }
  const matches = matchExisting(clients.map((c) => ({ ...c, rows: [], policies: [] })), existing);
  return Object.fromEntries([...matches].map(([key, m]) => [key, { id: m.id, label: m.label }]));
}

export type ImportResult =
  | { ok: true; batchId: string }
  | { ok: false; error: string };

export async function runImport(payload: ImportPayload): Promise<ImportResult> {
  const { supabase } = await requireFullSession();
  const parsed = importPayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "Some rows are not valid. Check the file and try again." };
  const { data, error } = await supabase.rpc("import_book", {
    p_file_name: parsed.data.file_name,
    p_contacts: parsed.data.clients,
  });
  if (error || !data) {
    if (error?.code === "P0002") return { ok: false, error: "A contact you matched could not be found (or is archived). Check again." };
    if (error?.code === "23514" || error?.code === "22023") return { ok: false, error: "A row has a value the CRM cannot store. Nothing was imported." };
    return { ok: false, error: "The import did not go through. Nothing was imported; please try again." };
  }
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { ok: true, batchId: (data as { batch_id: string }).batch_id };
}

export async function undoImport(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/import");
  const { data, error } = await supabase.from("import_batches").update({ status: "undone" }).eq("id", id).eq("status", "done").select("id");
  if (error) {
    const reason = error.message === "import_changed" ? "changed" : error.message === "import_too_old" ? "old" : "error";
    redirect(`/import?undo=${reason}`);
  }
  if (!data || data.length === 0) redirect("/import?undo=error");
  revalidatePath("/contacts");
  redirect("/import?undo=done");
}
