import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity } from "./types";

/** A contact's activity history, newest first. RLS limits it to the caller's rows. */
export async function activitiesForContact(supabase: SupabaseClient, contactId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("contact_id", contactId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load activity (${error.code ?? "unknown"}).`);
  return (data ?? []) as Activity[];
}
