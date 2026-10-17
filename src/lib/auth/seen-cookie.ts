import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { IDLE_LIMIT_SECONDS, SEEN_COOKIE } from "./session-policy";

/** The activity cookie (Phase 16): server-only (HttpOnly), same flags as the session cookies. */
export const SEEN_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
  secure: SESSION_COOKIE_OPTIONS.secure ?? true,
  maxAge: IDLE_LIMIT_SECONDS + 24 * 3600,
};

export const seenCookie = (now: number = Math.floor(Date.now() / 1000)) =>
  ({ name: SEEN_COOKIE, value: String(now), ...SEEN_COOKIE_OPTIONS });
