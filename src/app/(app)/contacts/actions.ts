"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { CONTACT_FORM_FIELDS, contactFormSchema } from "@/lib/contacts/schema";
import { findDuplicates, getContact, isUuid, knownTags, summarize, type ContactSummary } from "@/lib/contacts/data";
import { pickTags } from "@/lib/contacts/tags";
import type { Contact } from "@/lib/contacts/types";

// Every action re-checks the full (two-step) session on the server and writes through the
// user's own Supabase client, so RLS and the database constraints apply.

function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of CONTACT_FORM_FIELDS) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 5000);
  }
  // Ticked tags (several values with the same name), kept as JSON for redisplay.
  values.tags = JSON.stringify(formData.getAll("tags").filter((t): t is string => typeof t === "string").slice(0, 50));
  return values;
}

function friendlyDbError(code: string | undefined): FormState {
  if (code === "23503") return { fieldErrors: { referred_by_contact_id: "That referrer could not be found." } };
  if (code === "23514") return { error: "Some details are not valid. Check the highlighted fields and try again." };
  if (code === "42501") return { error: "You don't have permission to do that. Sign in again and retry." };
  return { error: "Could not save the contact. Please try again." };
}

export async function saveContact(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echoValues(formData);
  const idRaw = formData.get("id");
  const id = typeof idRaw === "string" && idRaw !== "" ? idRaw : null;
  if (id !== null && !isUuid(id)) return { error: "This contact could not be found.", values };

  const raw = Object.fromEntries(CONTACT_FORM_FIELDS.map((f) => [f, formData.get(f)]));
  const parsed = contactFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { fieldErrors, values };
  }
  // Tags are ticked from the agent's list (Phase 20); a tag the contact already has may stay.
  const [options, existing] = await Promise.all([knownTags(supabase), id ? getContact(supabase, id) : Promise.resolve(null)]);
  const selected = formData.getAll("tags").filter((t): t is string => typeof t === "string");
  const picked = pickTags(selected, [...options.map((o) => o.tag), ...(existing?.tags ?? [])]);
  if (picked.error) return { fieldErrors: { tags: picked.error }, values };
  const data = { ...parsed.data, tags: picked.tags };
  // Text typed in the referrer search but no contact tapped: never drop it silently.
  const referrerSearch = formData.get("referred_by_search");
  if (data.referred_by_contact_id === null && typeof referrerSearch === "string" && referrerSearch.trim() !== "") {
    return {
      fieldErrors: { referred_by_contact_id: "Tap the referrer in the list under the box, or clear the box." },
      values,
    };
  }
  if (id !== null && data.referred_by_contact_id === id) {
    return { fieldErrors: { referred_by_contact_id: "A contact cannot refer themselves." }, values };
  }

  // Possible-duplicate warning (new contacts only). A warning, not a block.
  if (id === null && formData.get("confirm_duplicate") !== "1") {
    const duplicates = await findDuplicates(supabase, data.email, data.phone, null);
    if (duplicates.length > 0) return { duplicates, values };
  }

  let savedId = id;
  if (id === null) {
    const { data: row, error } = await supabase.from("contacts").insert(data).select("id").single();
    if (error || !row) return { ...friendlyDbError(error?.code), values };
    savedId = row.id as string;
  } else {
    const { data: rows, error } = await supabase.from("contacts").update(data).eq("id", id).select("id");
    if (error) return { ...friendlyDbError(error.code), values };
    if (!rows || rows.length === 0) return { error: "This contact could not be found.", values };
  }

  revalidatePath("/contacts");
  redirect(`/contacts/${savedId}?saved=1`);
}

export async function setContactArchived(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  if (!isUuid(id)) redirect("/contacts");
  const { data: rows, error } = await supabase
    .from("contacts")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error || !rows || rows.length === 0) redirect(`/contacts/${id}?error=archive`);
  revalidatePath("/contacts");
  redirect(`/contacts/${id}?${archive ? "archived" : "restored"}=1`);
}

/** Referrer picker: up to 8 matching contacts, excluding the contact being edited. */
export async function searchReferrers(query: string, excludeId: string | null): Promise<ContactSummary[]> {
  const { supabase } = await requireFullSession();
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_contacts", {
    p_query: q, p_type: null, p_status: null, p_lead_source: null,
    p_archived: "all", p_sort: "name", p_limit: 9, p_offset: 0,
  });
  if (error) return [];
  return ((data ?? []) as Contact[])
    .filter((c) => c.id !== excludeId && !c.merged_into_contact_id)
    .slice(0, 8)
    .map(summarize);
}

/** Merge a duplicate into the contact to keep (Phase 17). One database transaction. */
export async function mergeContacts(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const keep = String(formData.get("keep") ?? "");
  const dup = String(formData.get("merge") ?? "");
  const from = String(formData.get("from") ?? "");
  if (!isUuid(keep) || !isUuid(dup) || !isUuid(from)) redirect("/contacts");
  const { error } = await supabase.rpc("merge_contacts", { p_keep: keep, p_merge: dup });
  if (error) {
    const reason = error.message === "already_merged" ? "already" : error.message === "keep_archived" ? "archived" : "failed";
    redirect(`/contacts/${from}/merge?with=${from === keep ? dup : keep}&keep=${keep}&error=${reason}`);
  }
  revalidatePath("/contacts");
  redirect(`/contacts/${keep}?merged=1`);
}
