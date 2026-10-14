import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/env";
import { SESSION_COOKIE_OPTIONS } from "./cookies";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers. It acts as the
 * signed-in user, so every query is subject to row level security. Create one per request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient(url, publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies. The middleware
          // refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
