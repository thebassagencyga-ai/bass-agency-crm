import { expect, test, type Page } from "@playwright/test";
import { todayInZone } from "../../src/lib/dates";
import { monthLabel } from "../../src/lib/production";
import { createTestUser, fullSessionClient, fullSessionCookies, ownStage } from "../support/supabase";

// Phase 28 (ADR-046): rates and goals in Settings, life commission details on a deal, and
// Reports → Production, on an iPhone-sized screen. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("set rates and goals, add life details, see production and expected commission", async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = await createTestUser("e2e-production");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");
  const thisMonth = `${today.slice(0, 7)}-01`;

  // Before any rates: the report says so and shows no made-up commission.
  await page.goto("/reports");
  await page.getByRole("navigation", { name: "Report" }).getByRole("link", { name: "Production" }).click();
  await expect(page.getByText("Add your commission rates in", { exact: false })).toBeVisible();

  // Settings → Commission and goals.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Edit commission and goals" }).click();
  await page.getByLabel("Auto new-business rate, percent").fill("15");
  await page.getByLabel("Auto renewal rate, percent").fill("10");
  await page.getByLabel("Term Life first-year rate, percent").fill("450");
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText("Use 0 to 100.")).toBeVisible();
  await page.getByLabel("Term Life first-year rate, percent").fill("45");
  await page.getByLabel("Term Life renewal rate, percent").fill("2");
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText("Rates saved.")).toBeVisible();
  await page.getByLabel("Premium per month").fill("$20,000");
  await page.getByLabel("Policies per month").fill("4");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByText("Goals saved.")).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  // Two sales this month: auto $1,000 and life $3,200.
  const { data: c } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Casey", last_name: "Sample" }).select("id").single();
  await api.from("opportunities").insert({ contact_id: c!.id, product_line: "auto", stage_id: await ownStage(api, "auto", "bound"), outcome: "won", estimated_annual_premium: 1000 });
  const { data: life } = await api.from("opportunities").insert({
    contact_id: c!.id, product_line: "life", stage_id: await ownStage(api, "life", "placed"), outcome: "won", estimated_annual_premium: 3200,
  }).select("id").single();

  // The life deal's commission details, with the live preview.
  await page.goto(`/opportunities/${life!.id}`);
  const details = page.getByRole("region", { name: "Commission details" });
  await details.getByLabel("Policy type").selectOption({ label: "Term Life" });
  await details.getByLabel("Premium mode").selectOption({ label: "Monthly" });
  await details.getByLabel("First payout date").fill(thisMonth);
  await expect(details.getByRole("status")).toContainText(`About $120.00 a month from ${monthLabel(thisMonth)}`);
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Commission details saved.")).toBeVisible();

  // Reports → Production.
  await page.goto("/reports/production");
  const glance = page.getByRole("region", { name: `${monthLabel(thisMonth)} at a glance` });
  await expect(glance).toContainText("$4,200");
  await expect(glance).toContainText("21% of your $20,000 goal");
  await expect(glance).toContainText("$270"); // auto 15% of $1,000 + the first life instalment
  const table = page.getByRole("table", { name: /Production and expected commission by line/ });
  await expect(table.getByRole("row", { name: /Auto/ })).toContainText("15%");
  await expect(table.getByRole("row", { name: /Life/ })).toContainText("$120");
  await expect(page.getByRole("list", { name: "Expected commission by month" }).getByRole("listitem")).toHaveCount(12);
  expect(await noSidewaysScroll(page)).toBe(true);

  // CSV: the caller's own figures.
  const csv = await page.request.get(`/reports/production/csv?month=${thisMonth.slice(0, 7)}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain("Next 12 months");
  expect(body).toContain("Auto");
});
