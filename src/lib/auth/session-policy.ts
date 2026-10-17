// Session time limits (Phase 16, ADR-032). Supabase Free has no inactivity timeout, so the app
// enforces two rules itself:
//   * Inactivity: signed out after 7 days without opening the CRM. A server-set, HttpOnly
//     cookie holds the time of the last visit; a session without it (or with an old one) ends.
//   * Two-step freshness: the authenticator code is asked again 12 hours after the last time it
//     was entered. The time comes from the signed access token (amr claim), not from a cookie.
// Pure, so every branch is unit tested.

export const SEEN_COOKIE = "crm_seen";
export const IDLE_LIMIT_SECONDS = 7 * 24 * 3600;
export const STEP_UP_SECONDS = 12 * 3600;
/** The activity cookie is rewritten at most this often (not on every request). */
export const SEEN_REFRESH_SECONDS = 3600;

/** Seconds since 1970 stored in the cookie; anything else counts as missing. */
export function parseSeen(value: string | undefined): number | null {
  if (!value || !/^\d{9,11}$/.test(value)) return null;
  return Number(value);
}

/** The latest time a second factor (TOTP) was verified, from the token's amr claim. */
export function lastMfaAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    if (entry && typeof entry === "object" && (entry as { method?: unknown }).method === "totp") {
      const ts = (entry as { timestamp?: unknown }).timestamp;
      if (typeof ts === "number" && (latest === null || ts > latest)) latest = ts;
    }
  }
  return latest;
}

export function isMfaFresh(mfaAt: number | null, now: number): boolean {
  return mfaAt !== null && now - mfaAt <= STEP_UP_SECONDS && mfaAt <= now + 300;
}

export type SeenDecision = { action: "ok" } | { action: "refresh" } | { action: "expire" };

/** What to do with a signed-in visit, given the activity cookie. */
export function seenDecision(seen: number | null, now: number): SeenDecision {
  if (seen === null || now - seen > IDLE_LIMIT_SECONDS || seen > now + 300) return { action: "expire" };
  return now - seen >= SEEN_REFRESH_SECONDS ? { action: "refresh" } : { action: "ok" };
}
