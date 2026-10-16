import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * A Supabase client with NO session: every call runs as the `anon` role. Used only by the
 * public intake form (ADR-028), whose one permitted call is public.submit_intake. It never
 * reads or sets cookies, so a signed-in visitor's session is not used either.
 */
export function createAnonClient() {
  const { url, publishableKey } = supabaseEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
