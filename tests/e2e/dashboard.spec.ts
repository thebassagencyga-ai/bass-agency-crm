import { expect, test, type Page } from "@playwright/test";
import { addDays, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 7 dashboard on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("dashboard: today's work, pipeline, renewals, recent activity and quick actions", async ({ page, context }) => {
  const owner = await createTestUser("e2e-dash");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const today = todayInZone("America/New_York");

  // Empty dashboard.
  await page.goto("/dashboard");
  await expect(page.getByText("Nothing overdue.")).toBeVisible();
  await expect(page.getByText("Nothing due today.")).toBeVisible();
  await expect(page.getByText("Nothing logged yet.", { exact: false })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  // Quick action: add a contact, then an opportunity (automation adds today's first-contact task).
  await page.getByRole("link", { name: "Add contact" }).click();
  await page.getByLabel("First name").fill("Dana");
  await page.getByLabel("Last name").fill("Example");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByText("Quote and policy dates").click();
  await page.getByLabel("Estimated annual premium", { exact: false }).fill("1,200");
  await page.getByLabel("Renewal date", { exact: false }).fill(addDays(today, 30));
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("list", { name: "Due today tasks" })).toContainText("Make initial contact");
  await expect(page.getByRole("link", { name: "1 Due today" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Open opportunities by product line" }).getByRole("link", { name: /Auto/ })).toContainText("$1,200/yr est.");
  await expect(page.getByText("1 in the next 60 days.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Soonest renewals" })).toContainText("Dana Example · Auto");

  // Done from the dashboard; the no-quote follow-up then appears in the next 7 days.
  await page.getByRole("list", { name: "Due today tasks" }).getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  await expect(page.getByText("Nothing due today.")).toBeVisible();
  await expect(page.getByRole("link", { name: "1 Next 7 days" })).toBeVisible();

  // Quick action: log activity needs a contact, then shows in recent activity.
  await page.getByRole("link", { name: "Log activity" }).click();
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await expect(page.getByText("Choose the contact from the list.")).toBeVisible();
  await page.getByPlaceholder("Search contacts by name, phone or email").fill("Dan");
  await page.getByRole("button", { name: /Dana Example/ }).click();
  await page.getByLabel("Outcome", { exact: false }).selectOption({ label: "Connected" });
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await expect(page.getByText("Activity logged.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("list", { name: "Recent activity" })).toContainText("Call · Dana Example");
  await expect(page.getByRole("list", { name: "Recent activity" })).toContainText("Connected");

  // Quick action: add task.
  await page.getByRole("link", { name: "Add task" }).click();
  await expect(page.getByRole("heading", { name: "Add task" })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});
