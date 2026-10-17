import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * A Supabase client with NO session: every call runs as the `anon` role. Used only by the
 * public intake form (ADR-028) and the calendar feed (ADR-034), whose only permitted calls are
 * public.submit_intake and public.calendar_feed. It never
 * reads or sets cookies, so a signed-in visitor's session is not used either.
 */
export function createAnonClient() {
  const { url, publishableKey } = supabaseEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
