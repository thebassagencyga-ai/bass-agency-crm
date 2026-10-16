// Turns a Supabase Auth error into the message the person sees (Phase 11). Pure, so it is
// unit tested. A wrong password and an outage must not look the same: "incorrect" when the
// service is down sends the owner hunting for the wrong problem.

export const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";
export const UNAVAILABLE = "Sign-in is unavailable right now. Check your connection and try again in a minute.";

type AuthErrorLike = { status?: number; name?: string } | null | undefined;

/** True when the request never got a real answer (network failure or server error). */
export function isServiceProblem(error: AuthErrorLike): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  return error.status === undefined || error.status === 0 || error.status >= 500;
}

/** The message for an auth error: rate limit, outage, or the caller's own wording. */
export function authErrorMessage(error: AuthErrorLike, otherwise: string): string {
  if (error?.status === 429) return TOO_MANY;
  if (isServiceProblem(error)) return UNAVAILABLE;
  return otherwise;
}
