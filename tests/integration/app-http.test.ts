import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, cookieJarClient, createTestUser, integrationEnv } from "../support/supabase";
import { totp } from "../support/totp";
import { lastMfaAt } from "@/lib/auth/session-policy";

// The app (Cloudflare build running in workerd) with real Supabase session cookies.
const { appUrl } = integrationEnv();

async function get(path: string, cookie = "") {
  return fetch(`${appUrl}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}
const location = (r: Response) => {
  const loc = r.headers.get("location");
  return loc ? new URL(loc, appUrl).pathname + new URL(loc, appUrl).search : null;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

let user: { id: string; email: string };
let session: ReturnType<typeof cookieJarClient>;
let factor: { id: string; secret: string };

beforeAll(async () => {
  user = await createTestUser("http");
  session = cookieJarClient();
  const { error } = await session.client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw error;
  session.jar.set("crm_seen", String(nowSeconds()));
});

describe("signed out", () => {
  it.each(["/dashboard", "/contacts", "/settings", "/reset-password"])("%s redirects to sign-in", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`/login?next=${encodeURIComponent(path)}`);
  });

  it("server actions on protected pages return 401", async () => {
    const res = await fetch(`${appUrl}/settings`, { method: "POST", headers: { "next-action": "x" }, body: "[]" });
    expect(res.status).toBe(401);
  });

  it("the sign-in page carries the security headers", async () => {
    const res = await get("/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("password-only session", () => {
  it("is sent to set up an authenticator, and cannot use server actions", async () => {
    const res = await get("/dashboard", session.header());
    expect(location(res)).toBe(`/mfa/setup?next=${encodeURIComponent("/dashboard")}`);
    const action = await fetch(`${appUrl}/settings`, {
      method: "POST", headers: { "next-action": "x", cookie: session.header() }, body: "[]",
    });
    expect(action.status).toBe(401);
  });

  it("can open the setup screen, which shows a QR code", async () => {
    const res = await get("/mfa/setup", session.header());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("QR code for your authenticator app");
  });
});

describe("full session", () => {
  beforeAll(async () => {
    const { data, error } = await session.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "http-test" });
    if (error || !data) throw error ?? new Error("enroll failed");
    const verify = await session.client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
    if (verify.error) throw verify.error;
    factor = { id: data.id, secret: data.totp.secret };
  });

  it("opens the app and shows the signed-in email", async () => {
    const res = await get("/settings", session.header());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(user.email);
    expect(html).toContain("On (required)");
  });

  it("is moved off the sign-in and MFA screens", async () => {
    expect(location(await get("/login", session.header()))).toBe("/dashboard");
    expect(location(await get("/mfa", session.header()))).toBe("/dashboard");
  });

  it("entering the code again renews the time the 12-hour rule checks", async () => {
    const before = lastMfaAt((await session.client.auth.getClaims()).data?.claims.amr);
    expect(before).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1100));
    // The next 30-second code, so it is not a replay of the one used to enrol.
    const again = await session.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.secret, Date.now() + 30_000) });
    expect(again.error).toBeNull();
    const after = lastMfaAt((await session.client.auth.getClaims()).data?.claims.amr);
    expect(after).toBeGreaterThan(before!);
  });

  it("rejects a tampered session cookie", async () => {
    const tampered = session.header().replace(/base64-([A-Za-z0-9_-]{10})/, "base64-AAAAAAAAAA");
    const res = await get("/dashboard", tampered);
    expect(res.status).toBe(307);
    expect(location(res)).toMatch(/^\/login/);
  });

  it("refreshes an expired session automatically and sends back a new HttpOnly cookie", async () => {
    // Rewrite the stored session so it looks expired; the refresh token is still valid.
    const names = [...session.jar.keys()].filter((n) => /-auth-token(\.\d+)?$/.test(n)).sort();
    const base = names[0]!.replace(/\.\d+$/, "");
    const raw = names.map((n) => session.jar.get(n)!).join("");
    const json = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
    json.expires_at = Math.floor(Date.now() / 1000) - 60;
    const expired = `${base}=base64-${Buffer.from(JSON.stringify(json)).toString("base64url")}; crm_seen=${nowSeconds()}`;

    const res = await get("/settings", expired);
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain(base);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("inactivity sign-out (Phase 16)", () => {
  // Each case signs in separately: an expired visit ends that session on the server too.
  async function freshSignIn() {
    const s = cookieJarClient();
    const { error } = await s.client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
    if (error) throw error;
    return s;
  }

  it.each([
    ["no activity cookie", null],
    ["an activity cookie 8 days old", nowSeconds() - 8 * 86_400],
    ["a malformed activity cookie", "abc"],
  ])("%s signs the session out and says why", async (_label, seen) => {
    const s = await freshSignIn();
    if (seen !== null) s.jar.set("crm_seen", String(seen));
    const res = await get("/dashboard", s.header());
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`/login?expired=1&next=${encodeURIComponent("/dashboard")}`);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/crm_seen=;/);
    // The session's refresh token no longer works.
    const { error } = await s.client.auth.refreshSession();
    expect(error).not.toBeNull();
  });

  it("a recent activity cookie keeps the session, and an hour-old one is renewed", async () => {
    const s = await freshSignIn();
    s.jar.set("crm_seen", String(nowSeconds() - 2 * 3600));
    const res = await get("/dashboard", s.header());
    // Password-only (this user has an authenticator): on to the code screen, not signed out.
    expect(location(res)).toBe(`/mfa?next=${encodeURIComponent("/dashboard")}`);
    const renewed = res.headers.getSetCookie().find((c) => c.startsWith("crm_seen="));
    expect(renewed).toBeDefined();
    expect(renewed!.toLowerCase()).toContain("httponly");
    expect(Number(/^crm_seen=(\d+)/.exec(renewed!)?.[1])).toBeGreaterThanOrEqual(nowSeconds() - 5);
  });
});
