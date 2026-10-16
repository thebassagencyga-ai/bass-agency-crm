import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/contacts/data";
import type { IntakeLink, IntakeSubmission } from "./types";

// Reads go through the signed-in user's client, so RLS (owner + two-step) decides visibility.

const COLUMNS = "id, status, first_name, last_name, email, phone, address_line1, city, state, household, vehicles, postal_code, preferred_contact_method, best_time, lines, current_coverage, heard_about, referred_by_name, submitted_at, consent_at";

export async function listNewSubmissions(supabase: SupabaseClient): Promise<IntakeSubmission[]> {
  const { data, error } = await supabase
    .from("intake_submissions").select(COLUMNS).eq("status", "new")
    .order("submitted_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load the intake inbox (${error.code ?? "unknown"}).`);
  return (data ?? []) as IntakeSubmission[];
}

export async function getSubmission(supabase: SupabaseClient, id: string): Promise<IntakeSubmission | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("intake_submissions").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the submission (${error.code ?? "unknown"}).`);
  return (data as IntakeSubmission | null) ?? null;
}

export async function countNewSubmissions(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("intake_submissions").select("id", { count: "exact", head: true }).eq("status", "new");
  return error ? 0 : (count ?? 0);
}

/** The agent's current link: the enabled one, else the most recent (turned off). */
export async function getIntakeLink(supabase: SupabaseClient): Promise<IntakeLink | null> {
  const { data, error } = await supabase
    .from("intake_links").select("id, token, enabled, created_at")
    .order("enabled", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not load the intake link (${error.code ?? "unknown"}).`);
  return (data as IntakeLink | null) ?? null;
}
