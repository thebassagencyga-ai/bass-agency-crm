import { describe, expect, it } from "vitest";
import { secureCookies } from "@/lib/supabase/cookies";

// Phase 11 security review: the local-test switch can never turn off Secure cookies on the
// real site.

describe("secureCookies", () => {
  it("is on in production", () => {
    expect(secureCookies({ NODE_ENV: "production", SITE_URL: "https://crm.example.com" })).toBe(true);
  });
  it("the test switch works only for a local http site", () => {
    expect(secureCookies({ NODE_ENV: "production", INSECURE_COOKIES_FOR_LOCAL_TESTS: "1", SITE_URL: "http://127.0.0.1:8787" })).toBe(false);
    expect(secureCookies({ NODE_ENV: "production", INSECURE_COOKIES_FOR_LOCAL_TESTS: "1", SITE_URL: "http://localhost:8787" })).toBe(false);
  });
  it.each([
    "https://bass-agency-crm.example.workers.dev",
    "http://crm.example.com",
    "https://127.0.0.1",
    "not a url",
    undefined,
  ])("the test switch is ignored for SITE_URL=%s", (site) => {
    expect(secureCookies({ NODE_ENV: "production", INSECURE_COOKIES_FOR_LOCAL_TESTS: "1", SITE_URL: site })).toBe(true);
  });
  it("is off in local development (plain http)", () => {
    expect(secureCookies({ NODE_ENV: "development" })).toBe(false);
  });
});
