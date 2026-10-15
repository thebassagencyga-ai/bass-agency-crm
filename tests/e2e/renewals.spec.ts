import { expect, test, type Page } from "@playwright/test";
import { addDays, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 8 renewals, retention outcomes and cross-sell on a phone-sized screen, with a real
// two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const duplicateIds = (page: Page) =>
  page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });

test("renewals: 6-month auto policy renewed, cross-sell reviewed, policy lost; cross-sell rules in Settings", async ({ page, context }) => {
  const owner = await createTestUser("e2e-renew");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const today = todayInZone("America/New_York");

  // A client with a 6-month auto policy renewing in 20 days.
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Rowan");
  await page.getByLabel("Last name").fill("Example");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const contactUrl = page.url().split("?")[0]!;
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByText("Quote and policy dates").click();
  await page.getByLabel("Estimated annual premium", { exact: false }).fill("1,000");
  await page.getByLabel("Renewal date", { exact: false }).fill(addDays(today, 20));
  await page.getByLabel("Policy term").selectOption({ label: "6 months" });
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  const oppUrl = page.url().split("?")[0]!;
  await expect(page.getByText("Renews every 6 months")).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.", { exact: false })).toBeVisible();

  // Renewals: listed within 30 days; cross-sell suggests home and life.
  await page.goto("/renewals?days=30");
  const policies = page.getByRole("list", { name: "Client policies" });
  await expect(policies).toContainText("Rowan Example · Auto");
  await expect(policies).toContainText("Renews every 6 months");
  await expect(policies).toContainText("Review task due");
  const crossSell = page.getByRole("list", { name: "Cross-sell reviews" });
  await expect(crossSell).toContainText("Review Home");
  await expect(crossSell).toContainText("Review Life");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Record "Renewed": an outcome is required; the date rolls 6 months forward.
  await policies.getByRole("link", { name: "Record outcome" }).click();
  await expect(page.getByRole("heading", { name: "Renewal · Rowan Example" })).toBeVisible();
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText("Choose what happened at renewal.")).toBeVisible();
  await page.getByLabel("Renewed", { exact: true }).check();
  await expect(page.getByText("The next renewal will be", { exact: false })).toBeVisible();
  await page.getByLabel("New annual premium", { exact: false }).fill("1,100");
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText("Renewal recorded.", { exact: false })).toBeVisible();
  // Back on Renewals (default window, 60 days): the next renewal is about 6 months away.
  await expect(page.getByText("No client policies renew in the next 60 days.")).toBeVisible();

  // Cross-sell: "Not now" hides Home for 12 months; Life stays and starts an opportunity.
  await crossSell.getByRole("button", { name: /^Not now: Home for Rowan Example/ }).click();
  await expect(page.getByText("Hidden for 12 months.")).toBeVisible();
  await expect(crossSell).not.toContainText("Review Home");
  await crossSell.getByRole("link", { name: "Start Life opportunity" }).click();
  await expect(page.getByRole("heading", { name: "Add opportunity" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Life" })).toBeChecked();

  // The policy shows its renewal history; then the client leaves at the next renewal.
  await page.goto(oppUrl);
  await expect(page.getByRole("list", { name: "Renewal history" })).toContainText("Renewed");
  await expect(page.getByRole("list", { name: "Renewal history" })).toContainText("$1,100.00/yr");
  await page.getByRole("link", { name: "Record renewal outcome" }).click();
  await page.getByLabel("Lost (client left)").check();
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText("Choose why the client left.")).toBeVisible();
  await page.getByLabel("Why did the client leave?").selectOption({ label: "Price" });
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText("the contact is now a former client", { exact: false })).toBeVisible();
  await page.goto(contactUrl);
  await expect(page.getByText("Former client").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Opportunities for this contact" })).toContainText("Policy ended");

  // Settings: four default rules, unique field ids, add one of your own.
  await page.goto("/settings");
  const rules = page.getByRole("list", { name: "Cross-sell rules" });
  await expect(rules.getByRole("listitem")).toHaveCount(4);
  await expect(rules).toContainText("Has Auto, no Home · Individuals only");
  expect(await duplicateIds(page)).toEqual([]);
  const add = page.locator("details").filter({ hasText: "Add a cross-sell rule" });
  await add.locator("summary").click();
  await add.getByRole("button", { name: "Add rule" }).click();
  await expect(add.getByText("Give the rule a name.")).toBeVisible();
  await add.getByLabel("Name").fill("Life client without auto");
  await add.getByRole("checkbox", { name: "Life" }).check();
  await add.getByLabel("…but nothing in", { exact: false }).selectOption({ label: "Auto" });
  await add.getByLabel("Reason shown with the prompt", { exact: false }).fill("Has life with you; ask who insures their vehicles.");
  await add.getByRole("button", { name: "Add rule" }).click();
  await expect(add.getByText("Rule added.")).toBeVisible();
  await expect(rules.getByRole("listitem")).toHaveCount(5);
  expect(await noSidewaysScroll(page)).toBe(true);
});
