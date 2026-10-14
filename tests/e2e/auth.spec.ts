import { expect, test } from "@playwright/test";
import { PASSWORD, createTestUser } from "../support/supabase";
import { totp, waitForNextTotpWindow } from "../support/totp";

// The owner's real sign-in journey on a phone-sized screen. Messages are located by text:
// Next.js adds its own empty role="alert" route announcer to every page.
test("sign in, set up two-step sign-in, use the app, sign out, sign back in with a code", async ({ page }) => {
  const user = await createTestUser("e2e");

  await page.goto("/contacts");
  await expect(page).toHaveURL(/\/login\?next=%2Fcontacts/);

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa\/setup/);
  await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();

  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText("That code didn't work", { exact: false })).toBeVisible();

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText(user.email)).toBeVisible();

  const cookies = await page.context().cookies();
  const authCookies = cookies.filter((c) => c.name.includes("auth-token"));
  expect(authCookies.length).toBeGreaterThan(0);
  expect(authCookies.every((c) => c.httpOnly)).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?signedOut=1/);
  await expect(page.getByText("You have been signed out.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa\?next=%2Fdashboard/);
  await waitForNextTotpWindow();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
