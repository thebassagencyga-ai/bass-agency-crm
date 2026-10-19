import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 22: Producr name and look, and Settings → Appearance (device / light / dark).
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("Producr name, wordmark and the appearance switch", async ({ page, context }) => {
  const owner = await createTestUser("e2e-brand");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  await page.goto("/dashboard");
  await expect(page).toHaveTitle("Dashboard · Producr CRM");
  await expect(page.getByRole("link", { name: "Producr CRM home" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/\b(dark|light)\b/); // follows the device

  await page.goto("/settings");
  const appearance = page.locator("#appearance");
  await appearance.getByText("Dark", { exact: true }).click();
  await appearance.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByText("Appearance saved.")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  // Dark workspace even though the test browser asks for light.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("main")!).backgroundColor)).toBe("rgb(11, 17, 24)");

  await page.goto("/contacts");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/); // remembered

  await page.goto("/settings");
  await appearance.getByText("Match this device", { exact: true }).click();
  await appearance.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByText("Appearance saved.")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("main")!).backgroundColor)).toBe("rgb(244, 246, 248)");
});
