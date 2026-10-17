import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CalendarFeedInfo {
  created_at: string;
  last_fetched_at: string | null;
}

/** The signed-in user's active calendar link, if any (its token is never stored, ADR-034). */
export async function getCalendarFeed(supabase: SupabaseClient): Promise<CalendarFeedInfo | null> {
  const { data, error } = await supabase
    .from("calendar_feeds").select("created_at, last_fetched_at").eq("enabled", true).maybeSingle();
  if (error) throw new Error(`Could not load the calendar link (${error.code ?? "unknown"}).`);
  return (data as CalendarFeedInfo | null) ?? null;
}
