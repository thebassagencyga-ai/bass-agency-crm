import { describe, expect, it } from "vitest";
import { decideRoute, type AuthState } from "@/lib/auth/routing";
import {
  IDLE_LIMIT_SECONDS, SEEN_REFRESH_SECONDS, STEP_UP_SECONDS, isMfaFresh, lastMfaAt, parseSeen, seenDecision,
} from "@/lib/auth/session-policy";

const now = 1_800_000_000;

describe("inactivity cookie", () => {
  it("reads only plain epoch seconds", () => {
    expect(parseSeen(String(now))).toBe(now);
    expect(parseSeen(undefined)).toBeNull();
    expect(parseSeen("yesterday")).toBeNull();
    expect(parseSeen("1e10")).toBeNull();
  });

  it("expires a session with no cookie, an old one, or one from the future", () => {
    expect(seenDecision(null, now)).toEqual({ action: "expire" });
    expect(seenDecision(now - IDLE_LIMIT_SECONDS - 1, now)).toEqual({ action: "expire" });
    expect(seenDecision(now + 3600, now)).toEqual({ action: "expire" });
  });

  it("keeps a recent visit, and refreshes the cookie at most hourly", () => {
    expect(seenDecision(now - 60, now)).toEqual({ action: "ok" });
    expect(seenDecision(now - SEEN_REFRESH_SECONDS, now)).toEqual({ action: "refresh" });
    expect(seenDecision(now - IDLE_LIMIT_SECONDS, now)).toEqual({ action: "refresh" });
  });
});

describe("two-step freshness", () => {
  it("takes the latest TOTP time from the token's amr claim", () => {
    expect(lastMfaAt([{ method: "password", timestamp: now - 10 }, { method: "totp", timestamp: now - 100 }, { method: "totp", timestamp: now - 50 }])).toBe(now - 50);
    expect(lastMfaAt([{ method: "password", timestamp: now }])).toBeNull();
    expect(lastMfaAt("totp")).toBeNull();
    expect(lastMfaAt(undefined)).toBeNull();
  });

  it("is fresh for 12 hours", () => {
    expect(isMfaFresh(now - STEP_UP_SECONDS, now)).toBe(true);
    expect(isMfaFresh(now - STEP_UP_SECONDS - 1, now)).toBe(false);
    expect(isMfaFresh(null, now)).toBe(false);
    expect(isMfaFresh(now + 3600, now)).toBe(false);
  });
});

describe("routing with a stale two-step session", () => {
  const stale: AuthState = { signedIn: true, aal: "aal2", hasVerifiedFactor: true, mfaFresh: false };
  const fresh: AuthState = { signedIn: true, aal: "aal2", hasVerifiedFactor: true, mfaFresh: true };

  it("asks for the code again before any page, and refuses actions", () => {
    expect(decideRoute("/contacts", stale)).toEqual({ action: "redirect", to: "/mfa?again=1&next=%2Fcontacts" });
    expect(decideRoute("/contacts", stale, { isServerAction: true })).toEqual({ action: "unauthorized" });
    expect(decideRoute("/mfa", stale)).toEqual({ action: "allow" });
  });

  it("lets a fresh session through and keeps it off the code screens", () => {
    expect(decideRoute("/contacts", fresh)).toEqual({ action: "allow" });
    expect(decideRoute("/mfa", fresh)).toEqual({ action: "redirect", to: "/dashboard" });
  });
});
