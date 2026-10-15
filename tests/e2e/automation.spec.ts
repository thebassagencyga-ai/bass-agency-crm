import { expect, test, type Page } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 6 automation on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("automatic tasks: new lead, quote, win; rule settings; no-response follow-up", async ({ page, context }) => {
  const owner = await createTestUser("e2e-auto");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Morgan");
  await page.getByLabel("Last name").fill("Example");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const contactUrl = page.url().split("?")[0]!;

  // New lead → first-contact task, visible on the opportunity and on Today.
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  const oppUrl = page.url().split("?")[0]!;
  const oppTasks = page.getByRole("list", { name: "Tasks for this opportunity" });
  await expect(oppTasks).toContainText("Make initial contact");
  await expect(oppTasks).toContainText("automatic");
  await page.goto("/tasks?view=today");
  await expect(page.getByRole("list", { name: "Today tasks" })).toContainText("Make initial contact");

  // Quote sent → follow-up task.
  await page.goto(`${oppUrl}/edit`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  await page.getByLabel("Quote sent on", { exact: false }).fill(today);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await expect(oppTasks).toContainText("Follow up on quote");

  // Won → prospecting tasks closed; onboarding, review and referral tasks added.
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.", { exact: false })).toBeVisible();
  for (const title of ["Thank the client", "Ask for a Google review", "Ask for a referral"]) await expect(oppTasks).toContainText(title);
  await expect(oppTasks.getByRole("link", { name: "Make initial contact" })).toHaveClass(/line-through/);
  await page.goto("/tasks?view=upcoming");
  await expect(page.getByRole("list", { name: "Upcoming tasks" })).toContainText("Ask for a Google review");

  // Settings: change a rule's timing, refuse an incentive in a message, turn a rule off.
  await page.goto("/settings");
  const rules = page.getByRole("list", { name: "Automation rules" });
  await expect(rules.getByRole("listitem")).toHaveCount(12);
  expect(await noSidewaysScroll(page)).toBe(true);
  const quoteRule = rules.getByRole("listitem").filter({ hasText: "Quote sent" });
  await quoteRule.locator("summary").click();
  await quoteRule.getByLabel("Days later").fill("5");
  await quoteRule.getByRole("button", { name: "Save rule" }).click();
  await expect(quoteRule.getByText("Rule saved.")).toBeVisible();
  await page.reload();
  await expect(rules.getByRole("listitem").filter({ hasText: "Quote sent" })).toContainText("5 days later");

  const reviewRule = rules.getByRole("listitem").filter({ hasText: "Google review" });
  await reviewRule.locator("summary").click();
  await reviewRule.getByLabel("Message", { exact: false }).fill("Leave us a review and get a $10 gift card {review_link}");
  await reviewRule.getByRole("button", { name: "Save rule" }).click();
  await expect(reviewRule.getByText("Messages can't offer anything in return", { exact: false })).toBeVisible();

  const leadRule = rules.getByRole("listitem").filter({ hasText: "New lead" });
  await leadRule.locator("summary").click();
  await leadRule.getByLabel("Turned on").uncheck();
  await leadRule.getByRole("button", { name: "Save rule" }).click();
  await expect(leadRule.getByText("Rule saved — it is turned off.")).toBeVisible();

  // With the rule off, a new lead gets no automatic task.
  await page.goto(contactUrl);
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByLabel("Home").check();
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("No tasks for this opportunity.")).toBeVisible();

  // No response → the CRM asks before adding the follow-up.
  await page.goto(contactUrl);
  await page.getByText("Log activity…").click();
  await page.getByLabel("Outcome", { exact: false }).selectOption({ label: "No response" });
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No response — follow up again?" })).toBeVisible();
  await page.getByRole("button", { name: "Add follow-up task" }).click();
  await expect(page.getByText("Follow-up task added.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Open tasks for this contact" })).toContainText("Follow up again (no response)");
});
