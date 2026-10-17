import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { contactDisplayName } from "./format";
import { CONTACTS_PAGE_SIZE, type ContactListParams } from "./params";
import { LEAD_SOURCE_SUGGESTIONS, type Contact } from "./types";

// Reads go through the signed-in user's Supabase client, so RLS decides what is visible.

export const isUuid = (value: string) => z.uuid().safeParse(value).success;

export async function listContacts(supabase: SupabaseClient, p: ContactListParams) {
  const { data, error } = await supabase.rpc("search_contacts", {
    p_query: p.q,
    p_type: p.type,
    p_status: p.status,
    p_lead_source: p.leadSource,
    p_archived: p.archived,
    p_sort: p.sort,
    p_limit: CONTACTS_PAGE_SIZE + 1,
    p_offset: (p.page - 1) * CONTACTS_PAGE_SIZE,
    p_tag: p.tag,
  });
  if (error) throw new Error(`Could not load contacts (${error.code ?? "unknown"}).`);
  const rows = (data ?? []) as Contact[];
  return { rows: rows.slice(0, CONTACTS_PAGE_SIZE), hasMore: rows.length > CONTACTS_PAGE_SIZE };
}

export async function getContact(supabase: SupabaseClient, id: string): Promise<Contact | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the contact (${error.code ?? "unknown"}).`);
  return (data as Contact | null) ?? null;
}

export interface ContactSummary {
  id: string;
  label: string;
  detail: string;
  archived?: boolean;
}

export function summarize(c: Contact): ContactSummary {
  const detail = [c.phone, c.email, c.archived_at ? "archived" : null].filter(Boolean).join(" · ");
  return { id: c.id, label: contactDisplayName(c), detail, archived: c.archived_at !== null };
}

export async function getReferrals(supabase: SupabaseClient, id: string): Promise<ContactSummary[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("referred_by_contact_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load referrals (${error.code ?? "unknown"}).`);
  return ((data ?? []) as Contact[]).map(summarize);
}

export async function findDuplicates(
  supabase: SupabaseClient,
  email: string | null,
  phone: string | null,
  excludeId: string | null,
): Promise<ContactSummary[]> {
  if (!email && !phone) return [];
  const { data, error } = await supabase.rpc("find_possible_duplicates", {
    p_email: email,
    p_phone: phone,
    p_exclude_id: excludeId,
  });
  if (error) return []; // a warning only; never block saving because the check failed
  return ((data ?? []) as Contact[]).map(summarize);
}

export interface TagCount {
  tag: string;
  contact_count: number;
}

/** Tags in use, with how many contacts carry each (Phase 17). */
export async function knownTags(supabase: SupabaseClient): Promise<TagCount[]> {
  const { data, error } = await supabase.rpc("contact_tags");
  if (error) return [];
  return (data ?? []) as TagCount[];
}

export async function leadSourceOptions(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.rpc("contact_lead_sources");
  const used = ((data ?? []) as string[]).filter(Boolean);
  const seen = new Set(used.map((s) => s.toLowerCase()));
  return [...used, ...LEAD_SOURCE_SUGGESTIONS.filter((s) => !seen.has(s.toLowerCase()))];
}

/** What hangs off a contact, for the merge preview (Phase 17). */
export async function relatedCounts(supabase: SupabaseClient, contactId: string) {
  const count = async (table: string, column = "contact_id") => {
    const { count: n } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, contactId);
    return n ?? 0;
  };
  const [opportunities, tasks, activities, household, vehicles, referrals] = await Promise.all([
    count("opportunities"), count("tasks"), count("activities"), count("household_members"), count("vehicles"),
    count("contacts", "referred_by_contact_id"),
  ]);
  return { opportunities, tasks, activities, household, vehicles, referrals };
}

/** Contacts matching a search, for picking the other contact to merge with. */
export async function searchForMerge(supabase: SupabaseClient, query: string, excludeId: string): Promise<ContactSummary[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_contacts", {
    p_query: q, p_type: null, p_status: null, p_lead_source: null, p_archived: "all", p_sort: "name", p_limit: 11, p_offset: 0, p_tag: null,
  });
  if (error) return [];
  return ((data ?? []) as Contact[]).filter((c) => c.id !== excludeId && !c.merged_into_contact_id).slice(0, 10).map(summarize);
}
