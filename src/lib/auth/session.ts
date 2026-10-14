import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthState } from "./routing";

/**
 * Reads the caller's sign-in state. The assurance level comes from getClaims(), which
 * verifies the access token's signature, so a tampered cookie cannot claim aal2. Whether an
 * authenticator is enrolled only decides which MFA screen to show; the database enforces
 * aal2 regardless (ADR-016). Any failure is treated as signed out (fail closed).
 */
export async function readAuthState(supabase: SupabaseClient): Promise<{ state: AuthState; userId?: string; email?: string }> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return { state: { signedIn: false } };
    const aal = claims.aal === "aal2" ? "aal2" : "aal1";
    let hasVerifiedFactor = aal === "aal2";
    if (!hasVerifiedFactor) {
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      hasVerifiedFactor = level?.nextLevel === "aal2";
    }
    return {
      state: { signedIn: true, aal, hasVerifiedFactor },
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : undefined,
    };
  } catch {
    return { state: { signedIn: false } };
  }
}
