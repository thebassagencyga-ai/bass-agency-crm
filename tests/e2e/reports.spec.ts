import { expect, test, type Page } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 9 reports on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("reports: a won quote shows in leads, quotes and conversion; periods; every report has a definition", async ({ page, context }) => {
  const owner = await createTestUser("e2e-reports");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  // Empty reports first.
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("— (none closed)").first()).toBeVisible();

  // A website lead, quoted and won today.
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Sky");
  await page.getByLabel("Last name").fill("Example");
  await page.getByLabel("Lead source", { exact: false }).fill("Website");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByRole("radio", { name: "Home", exact: true }).check();
  await page.getByText("Quote and policy dates").click();
  await page.getByLabel("Quote sent on", { exact: false }).fill(today);
  await page.getByLabel("Estimated annual premium", { exact: false }).fill("1,500");
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.", { exact: false })).toBeVisible();

  await page.goto("/reports");
  const conversion = page.getByRole("region", { name: "Conversion rate" });
  await expect(conversion.getByText("100% (1 of 1 closed)", { exact: true }).first()).toBeVisible();
  const leads = page.getByRole("table", { name: "New leads by source" });
  await expect(leads.getByRole("row", { name: /Website/ })).toContainText("1");
  const quotes = page.getByRole("table", { name: "Quotes sent by product line" });
  await expect(quotes.getByRole("row", { name: /Home/ })).toContainText("$1,500");
  await expect(page.getByText("How it's counted:")).toHaveCount(9);
  expect(await noSidewaysScroll(page)).toBe(true);

  // Other periods: year to date includes today's win; last month has nothing closed.
  await page.getByRole("link", { name: "Year to date" }).click();
  await expect(page).toHaveURL(/period=year_to_date/);
  await expect(conversion.getByText("100% (1 of 1 closed)", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Last month" }).click();
  await expect(page).toHaveURL(/period=last_month/);
  await expect(conversion.getByText("— (none closed)", { exact: true })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});
