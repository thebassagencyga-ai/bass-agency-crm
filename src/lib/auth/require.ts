import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readAuthState } from "./session";

/**
 * Server-side gate for protected layouts, pages and Server Actions. The middleware already
 * redirects, but this check runs where the data is used (defense in depth, ADR-015).
 */
export async function requireFullSession() {
  const supabase = await createClient();
  const { state, userId, email } = await readAuthState(supabase);
  if (!state.signedIn || !userId) redirect("/login");
  if (state.aal !== "aal2") redirect(state.hasVerifiedFactor ? "/mfa" : "/mfa/setup");
  return { supabase, userId, email: email ?? "" };
}
