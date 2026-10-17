import { describe, expect, it } from "vitest";
import { decideRoute, safeNextPath, type AuthState } from "@/lib/auth/routing";

const signedOut: AuthState = { signedIn: false };
const aal1Enrolled: AuthState = { signedIn: true, aal: "aal1", hasVerifiedFactor: true };
const aal1New: AuthState = { signedIn: true, aal: "aal1", hasVerifiedFactor: false };
const aal2: AuthState = { signedIn: true, aal: "aal2", hasVerifiedFactor: true };

describe("decideRoute", () => {
  it.each(["/dashboard", "/contacts", "/settings", "/reset-password", "/"])(
    "sends a signed-out visitor from %s to login, remembering where they were going",
    (path) => {
      const decision = decideRoute(path, signedOut);
      expect(decision).toEqual({ action: "redirect", to: `/login?next=${encodeURIComponent(path === "/" ? "/dashboard" : path)}` });
    },
  );

  it.each(["/login", "/forgot-password", "/auth/confirm"])("lets a signed-out visitor open %s", (path) => {
    expect(decideRoute(path, signedOut)).toEqual({ action: "allow" });
  });

  it("lets anyone open and submit the public intake form, but not the agent's intake inbox", () => {
    expect(decideRoute("/quote/0123456789abcdef0123456789abcdef", signedOut)).toEqual({ action: "allow" });
    expect(decideRoute("/quote/0123456789abcdef0123456789abcdef", signedOut, { isServerAction: true })).toEqual({ action: "allow" });
    expect(decideRoute("/quote/0123456789abcdef0123456789abcdef", aal2)).toEqual({ action: "allow" });
    expect(decideRoute("/intake", signedOut).action).toBe("redirect");
    expect(decideRoute("/intake/new", signedOut, { isServerAction: true })).toEqual({ action: "unauthorized" });
    expect(decideRoute("/quotes", signedOut).action).toBe("redirect");
    // Phase 18: the calendar feed is read by calendar apps without a session.
    expect(decideRoute(`/calendar/${"a".repeat(64)}.ics`, signedOut)).toEqual({ action: "allow" });
    expect(decideRoute("/calendars", signedOut).action).toBe("redirect");
  });

  it("keeps the query string when sending a visitor to sign in", () => {
    expect(decideRoute("/contacts", signedOut, { search: "?status=archived" })).toEqual({
      action: "redirect",
      to: `/login?next=${encodeURIComponent("/contacts?status=archived")}`,
    });
  });

  it("sends a password-only session with an authenticator to the code screen", () => {
    expect(decideRoute("/contacts", aal1Enrolled)).toEqual({ action: "redirect", to: "/mfa?next=%2Fcontacts" });
  });

  it("sends a password-only session without an authenticator to set one up", () => {
    expect(decideRoute("/contacts", aal1New)).toEqual({ action: "redirect", to: "/mfa/setup?next=%2Fcontacts" });
  });

  it("never lets a password-only session reach the app, even if it claims a factor", () => {
    for (const path of ["/dashboard", "/contacts/123", "/settings", "/reset-password"]) {
      expect(decideRoute(path, aal1Enrolled).action).toBe("redirect");
      expect(decideRoute(path, aal1New).action).toBe("redirect");
    }
  });

  it("lets a password-only session use the MFA screens", () => {
    expect(decideRoute("/mfa", aal1Enrolled)).toEqual({ action: "allow" });
    expect(decideRoute("/mfa/setup", aal1New)).toEqual({ action: "allow" });
  });

  it("does not offer setup again to someone who already has an authenticator", () => {
    expect(decideRoute("/mfa/setup", aal1Enrolled)).toEqual({ action: "redirect", to: "/mfa" });
  });

  it("lets a fully signed-in user into the app and moves them off sign-in screens", () => {
    expect(decideRoute("/contacts", aal2)).toEqual({ action: "allow" });
    expect(decideRoute("/", aal2)).toEqual({ action: "redirect", to: "/dashboard" });
    expect(decideRoute("/login", aal2)).toEqual({ action: "redirect", to: "/dashboard" });
    expect(decideRoute("/mfa", aal2)).toEqual({ action: "redirect", to: "/dashboard" });
  });

  it("returns 401 instead of a redirect for unauthenticated API and server-action calls", () => {
    expect(decideRoute("/api/anything", signedOut)).toEqual({ action: "unauthorized" });
    expect(decideRoute("/contacts", signedOut, { isServerAction: true })).toEqual({ action: "unauthorized" });
    expect(decideRoute("/contacts", aal1Enrolled, { isServerAction: true })).toEqual({ action: "unauthorized" });
  });

  it("still allows sign-in form actions on public pages", () => {
    expect(decideRoute("/login", signedOut, { isServerAction: true })).toEqual({ action: "allow" });
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/contacts", "/contacts"],
    ["/contacts/abc?tab=tasks", "/contacts/abc?tab=tasks"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.example.com", "/dashboard"],
    ["//evil.example.com", "/dashboard"],
    ["/\\evil.example.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["contacts", "/dashboard"],
    ["/login", "/dashboard"],
    ["/mfa", "/dashboard"],
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
