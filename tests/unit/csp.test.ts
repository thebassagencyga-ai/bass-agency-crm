import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, SECURITY_HEADERS } from "@/lib/security/headers";

describe("Content Security Policy", () => {
  const csp = buildContentSecurityPolicy("abc123", { development: false });
  const directives = Object.fromEntries(
    csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
  );

  it("allows scripts only from this site with the per-request nonce", () => {
    expect(directives["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(directives["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("blocks framing, plugins, foreign form targets and base-tag hijacking", () => {
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
  });

  it("lets the browser talk only to this site (no direct database access from the browser)", () => {
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
  });

  it("allows data: images for the authenticator QR code", () => {
    expect(directives["img-src"]).toEqual(["'self'", "data:"]);
  });

  it("allows eval only in local development (React dev tooling)", () => {
    expect(buildContentSecurityPolicy("n", { development: true })).toContain("'unsafe-eval'");
  });
});

describe("static security headers", () => {
  it("sets the standard protective headers", () => {
    expect(SECURITY_HEADERS).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
  });
});
