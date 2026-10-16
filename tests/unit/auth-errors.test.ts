import { describe, expect, it } from "vitest";
import { TOO_MANY, UNAVAILABLE, authErrorMessage, isServiceProblem } from "@/lib/auth/errors";

// Phase 11 error handling: an outage must not be reported as a wrong password or code.

describe("authErrorMessage", () => {
  it("keeps the caller's wording for a real rejection (wrong password / code)", () => {
    expect(authErrorMessage({ status: 400, name: "AuthApiError" }, "Email or password is incorrect.")).toBe("Email or password is incorrect.");
    expect(authErrorMessage({ status: 422 }, "That code didn't work.")).toBe("That code didn't work.");
  });
  it("says to wait when rate-limited", () => {
    expect(authErrorMessage({ status: 429 }, "x")).toBe(TOO_MANY);
  });
  it.each([
    [{ name: "AuthRetryableFetchError", status: 0 }],
    [{ status: 0 }],
    [{ status: 500 }],
    [{ status: 503 }],
    [{}],
  ])("says the service is unavailable for %j", (error) => {
    expect(isServiceProblem(error)).toBe(true);
    expect(authErrorMessage(error, "Email or password is incorrect.")).toBe(UNAVAILABLE);
  });
  it("no error is not a problem", () => {
    expect(isServiceProblem(null)).toBe(false);
  });
});
