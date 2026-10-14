import { describe, expect, it } from "vitest";
import { emailSchema, newPasswordSchema, signInSchema, totpCodeSchema } from "@/lib/auth/forms";

describe("sign-in form", () => {
  it("accepts a valid email and password, trimming and lower-casing the email", () => {
    const r = signInSchema.safeParse({ email: "  Pat@Example.com ", password: "x" });
    expect(r.success && r.data.email).toBe("pat@example.com");
  });
  it.each([
    [{ email: "not-an-email", password: "x" }],
    [{ email: "pat@example.com", password: "" }],
    [{ email: "pat@example.com", password: "x".repeat(201) }],
  ])("rejects %j", (input) => {
    expect(signInSchema.safeParse(input).success).toBe(false);
  });
});

describe("authenticator code", () => {
  it.each(["123456", " 123 456 "])("accepts %j", (code) => {
    expect(totpCodeSchema.safeParse(code).success).toBe(true);
  });
  it.each(["12345", "1234567", "abcdef", ""])("rejects %j", (code) => {
    expect(totpCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("new password", () => {
  it("requires at least 12 characters with lower, upper case and a digit, and a matching confirmation", () => {
    expect(newPasswordSchema.safeParse({ password: "Fictional-Pass-2026", confirm: "Fictional-Pass-2026" }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: "Short1a", confirm: "Short1a" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "alllowercase123", confirm: "alllowercase123" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "Fictional-Pass-2026", confirm: "Different-Pass-2026" }).success).toBe(false);
  });
});

describe("email-only form", () => {
  it("validates the forgot-password email", () => {
    expect(emailSchema.safeParse({ email: "pat@example.com" }).success).toBe(true);
    expect(emailSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
