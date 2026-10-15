import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 4 opportunities on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

const noSidewaysScroll = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("add opportunities, move through the pipeline, lose, reopen, win and search", async ({ page, context, browser }) => {
  const owner = await createTestUser("e2e-opps");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  // A contact to work with.
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Jordan");
  await page.getByLabel("Last name").fill("Example");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const contactUrl = page.url().split("?")[0]!;
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  await expect(page.getByText("None yet.")).toBeVisible();

  // Home opportunity with quote details; renewal before effective is refused.
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByLabel("Home").check();
  await page.getByLabel("Starting stage").selectOption({ label: "Contacted" });
  await page.getByLabel("Description", { exact: false }).fill("Lake house");
  await page.getByText("Quote and policy dates").click();
  await page.getByLabel("Quoted carrier", { exact: false }).fill("Example Mutual");
  await page.getByLabel("Estimated annual premium", { exact: false }).fill("$1,250");
  await page.getByLabel("Effective date", { exact: false }).fill("2026-11-01");
  await page.getByLabel("Renewal date", { exact: false }).fill("2026-10-01");
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("The renewal date must be after the effective date.")).toBeVisible();
  await expect(page.getByLabel("Home")).toBeChecked(); // choice survives the form reset
  await page.getByLabel("Renewal date", { exact: false }).fill("2027-11-01");
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home · Jordan Example" })).toBeVisible();
  await expect(page.getByText("$1,250.00")).toBeVisible();
  const homeUrl = page.url().split("?")[0]!;

  // A second opportunity for the same contact, in another line.
  await page.goto(contactUrl);
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByRole("button", { name: "Add opportunity" }).click(); // Auto / New Lead defaults
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await page.getByRole("button", { name: "Move to nurture" }).click();
  await expect(page.getByText("Moved to nurture.")).toBeVisible();
  await page.goto(contactUrl);
  const list = page.getByRole("list", { name: "Opportunities for this contact" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("Nurture");

  // Board: move the home card from Contacted to Quoted.
  await page.goto("/opportunities?line=home");
  await expect(page.getByRole("heading", { name: /Contacted \(1\)/ })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByLabel("Move Jordan Example to stage").selectOption({ label: "Quoted" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Quoted \(1\)/ })).toBeVisible();

  // Lost from the board needs a reason, given on the opportunity page.
  await page.getByLabel("Move Jordan Example to stage").selectOption({ label: "Lost…" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByLabel("Why was it lost?")).toBeVisible();
  await page.getByRole("button", { name: "Mark as lost" }).click();
  await expect(page.getByText("Choose why it was lost.")).toBeVisible();
  await page.getByLabel("Why was it lost?").selectOption({ label: "Price" });
  await page.getByRole("button", { name: "Mark as lost" }).click();
  await expect(page.getByText("Marked as lost.")).toBeVisible();
  await expect(page.getByText("Price")).toBeVisible();

  // Reopen keeps history, then win.
  await page.getByLabel("Reopen at stage").selectOption({ label: "Follow Up" });
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Opportunity reopened.")).toBeVisible();
  await expect(page.getByText("Times reopened")).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.")).toBeVisible();

  // Edit details.
  await page.getByRole("link", { name: "Edit details" }).click();
  await page.getByLabel("Next action", { exact: false }).fill("Send welcome packet");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await expect(page.getByText("Send welcome packet")).toBeVisible();

  // Table search across product lines.
  await page.goto("/opportunities?view=table&q=jordan");
  await expect(page.getByRole("list", { name: "Opportunities" }).getByRole("listitem")).toHaveCount(2);
  expect(await noSidewaysScroll(page)).toBe(true);

  // Another account cannot open the opportunity by URL.
  const stranger = await createTestUser("e2e-opps-stranger");
  const strangerContext = await browser.newContext({ baseURL: APP_URL });
  await strangerContext.addCookies(await fullSessionCookies(stranger.email, APP_URL));
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(homeUrl);
  await expect(strangerPage.getByRole("heading", { name: "Opportunity not found" })).toBeVisible();
  await strangerPage.goto(`${new URL(homeUrl).pathname}/edit`);
  await expect(strangerPage.getByRole("heading", { name: "Opportunity not found" })).toBeVisible();
  await strangerContext.close();
});
