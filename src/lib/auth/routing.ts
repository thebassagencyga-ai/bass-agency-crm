// Who may open which page (ADR-015). Pure, so every branch is unit tested. Used by
// src/middleware.ts; protected layouts and server actions check again on the server.
//
// Assurance levels: aal1 = password only; aal2 = password + authenticator code.
// Two-step login is mandatory, so only aal2 sessions reach the app.

export type AuthState =
  | { signedIn: false }
  | { signedIn: true; aal: "aal1" | "aal2"; hasVerifiedFactor: boolean };

export type RouteDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string }
  | { action: "unauthorized" };

export const HOME_PATH = "/dashboard";
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm"];
const MFA_PATHS = ["/mfa", "/mfa/setup"];
const NOT_A_DESTINATION = [...PUBLIC_PATHS, ...MFA_PATHS, "/auth"];

const matches = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export function decideRoute(
  pathname: string,
  state: AuthState,
  options: { isServerAction?: boolean; search?: string } = {},
): RouteDecision {
  const isApi = matches(pathname, ["/api"]);
  const wantsJson = isApi || options.isServerAction === true;
  const target = pathname === "/" ? HOME_PATH : `${pathname}${options.search ?? ""}`;

  if (matches(pathname, PUBLIC_PATHS)) {
    if (state.signedIn && state.aal === "aal2" && pathname === "/login") {
      return { action: "redirect", to: HOME_PATH };
    }
    return { action: "allow" };
  }

  if (!state.signedIn) {
    return wantsJson
      ? { action: "unauthorized" }
      : { action: "redirect", to: `/login?next=${encodeURIComponent(target)}` };
  }

  if (state.aal !== "aal2") {
    if (matches(pathname, MFA_PATHS)) {
      if (pathname === "/mfa/setup" && state.hasVerifiedFactor) return { action: "redirect", to: "/mfa" };
      if (pathname === "/mfa" && !state.hasVerifiedFactor) return { action: "redirect", to: "/mfa/setup" };
      return { action: "allow" };
    }
    if (wantsJson) return { action: "unauthorized" };
    const step = state.hasVerifiedFactor ? "/mfa" : "/mfa/setup";
    return { action: "redirect", to: `${step}?next=${encodeURIComponent(target)}` };
  }

  if (pathname === "/" || matches(pathname, MFA_PATHS)) {
    return { action: "redirect", to: HOME_PATH };
  }
  return { action: "allow" };
}

/**
 * Validates a user-supplied "next" location so sign-in can never redirect to another site
 * (open redirect) or loop back into the sign-in screens.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(raw, "http://local.invalid");
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== "http://local.invalid") return HOME_PATH;
  if (matches(url.pathname, NOT_A_DESTINATION)) return HOME_PATH;
  return `${url.pathname}${url.search}`;
}
