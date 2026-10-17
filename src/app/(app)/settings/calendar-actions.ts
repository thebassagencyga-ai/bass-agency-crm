"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFullSession } from "@/lib/auth/require";

export type CalendarLinkState = { token?: string; error?: string };

/** Creates (or replaces) the calendar link and hands the token back once (Phase 18). */
export async function createCalendarLink(): Promise<CalendarLinkState> {
  const { supabase } = await requireFullSession();
  const { data, error } = await supabase.rpc("rotate_calendar_link");
  if (error || typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) return { error: "Could not create the link. Please try again." };
  revalidatePath("/settings");
  return { token: data };
}

export async function turnOffCalendarLink(): Promise<void> {
  const { supabase } = await requireFullSession();
  const { error } = await supabase.from("calendar_feeds").update({ enabled: false, disabled_at: new Date().toISOString() }).eq("enabled", true);
  redirect(`/settings?calendar=${error ? "error" : "off"}#calendar`);
}
