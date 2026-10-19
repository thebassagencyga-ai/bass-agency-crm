import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * A Supabase client with NO session: every call runs as the `anon` role. Used only by the
 * public intake form (ADR-028), the calendar feed (ADR-034) and new-lead alerts (ADR-044), whose
 * only permitted calls are public.submit_intake, public.calendar_feed and public.claim_push_alerts. It never
 * reads or sets cookies, so a signed-in visitor's session is not used either.
 */
export function createAnonClient() {
  const { url, publishableKey } = supabaseEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
