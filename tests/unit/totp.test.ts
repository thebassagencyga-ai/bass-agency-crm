import { describe, expect, it } from "vitest";
import { totp } from "../support/totp";

// RFC 6238 Appendix B test vector (SHA-1): secret "12345678901234567890" (base32 below),
// time 59 s → 94287082; authenticator apps use the last 6 digits.
describe("test TOTP generator", () => {
  it("matches the RFC 6238 reference vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1_111_111_109_000)).toBe("081804");
    expect(totp(secret, 2_000_000_000_000)).toBe("279037");
  });
});
