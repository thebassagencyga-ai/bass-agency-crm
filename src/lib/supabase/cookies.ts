import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Whether session cookies carry the Secure flag. Always in production, except for the local
 * workerd test run (plain http://127.0.0.1) — and that exception is honoured only when
 * SITE_URL itself is local, so setting the test flag on the real site has no effect
 * (Phase 11 security review).
 */
export function secureCookies(env: { NODE_ENV?: string; INSECURE_COOKIES_FOR_LOCAL_TESTS?: string; SITE_URL?: string }): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.INSECURE_COOKIES_FOR_LOCAL_TESTS !== "1") return true;
  try {
    const { protocol, hostname } = new URL(env.SITE_URL ?? "");
    return !(protocol === "http:" && ["127.0.0.1", "localhost"].includes(hostname));
  } catch {
    return true;
  }
}

// Session cookies: HttpOnly (page scripts cannot read them; there is no browser Supabase
// client), Secure outside local development, SameSite=Lax. Supabase's default is
// httpOnly: false because it assumes a browser client.
export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: secureCookies(process.env),
};
