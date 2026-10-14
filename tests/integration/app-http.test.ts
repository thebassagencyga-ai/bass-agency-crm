import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, cookieJarClient, createTestUser, integrationEnv } from "../support/supabase";
import { totp } from "../support/totp";

// The app (Cloudflare build running in workerd) with real Supabase session cookies.
const { appUrl } = integrationEnv();

async function get(path: string, cookie = "") {
  return fetch(`${appUrl}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
}
const location = (r: Response) => {
  const loc = r.headers.get("location");
  return loc ? new URL(loc, appUrl).pathname + new URL(loc, appUrl).search : null;
};

let user: { id: string; email: string };
let session: ReturnType<typeof cookieJarClient>;

beforeAll(async () => {
  user = await createTestUser("http");
  session = cookieJarClient();
  const { error } = await session.client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw error;
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
    const expired = `${base}=base64-${Buffer.from(JSON.stringify(json)).toString("base64url")}`;

    const res = await get("/settings", expired);
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain(base);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});
