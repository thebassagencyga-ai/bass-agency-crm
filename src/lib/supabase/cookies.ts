import type { CookieOptionsWithName } from "@supabase/ssr";

// Session cookies: HttpOnly (page scripts cannot read them; there is no browser Supabase
// client), Secure outside local development, SameSite=Lax. Supabase's default is
// httpOnly: false because it assumes a browser client.
export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES_FOR_LOCAL_TESTS !== "1",
};
