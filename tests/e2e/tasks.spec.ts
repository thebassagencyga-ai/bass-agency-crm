import { expect, test, type Page } from "@playwright/test";
import { addDays, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 5 tasks and activity history on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("tasks: add, schedule, review message, complete, reopen; log activity; history", async ({ page, context, browser }) => {
  const owner = await createTestUser("e2e-tasks");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const today = todayInZone("America/New_York");

  // Settings: name and Google review link (https only).
  await page.goto("/settings");
  await page.getByLabel("Your name", { exact: false }).fill("Rich Example");
  await page.getByLabel("Google review link", { exact: false }).fill("g.page/r/fictional");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Paste the full link, starting with https://")).toBeVisible();
  await page.getByLabel("Google review link", { exact: false }).fill("https://g.page/r/fictional-example");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // A contact with a mobile number.
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Casey");
  await page.getByLabel("Last name").fill("Example");
  await page.getByLabel("Phone", { exact: false }).first().fill("770-555-0150");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const contactUrl = page.url().split("?")[0]!;
  await expect(page.getByText("No open tasks.")).toBeVisible();

  // Task from the contact page: title required; due today by default; high priority.
  await page.getByRole("link", { name: "Add task" }).click();
  await page.getByLabel("Priority").selectOption({ label: "High" });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Enter what needs doing.")).toBeVisible();
  await expect(page.getByLabel("Priority")).toHaveValue("high"); // choice survives the error
  await page.getByLabel("What needs doing").fill("Call about renewal");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task saved.")).toBeVisible();
  await expect(page.getByText("Due today")).toBeVisible();

  // Review request from the Tasks page, picking the contact; starts tomorrow, due in 30 days.
  await page.goto("/tasks");
  await page.getByRole("link", { name: "Add task" }).click();
  await page.getByPlaceholder("Search contacts by name, phone or email").fill("Case");
  await page.getByRole("button", { name: /Casey Example/ }).click();
  await page.getByLabel("What needs doing").fill("Ask for a review");
  await page.getByLabel("Type", { exact: true }).selectOption({ label: "Google review request" });
  await page.getByLabel("Due date").fill(addDays(today, 31));
  await page.getByText("More details").click();
  await page.getByLabel("Don't show before", { exact: false }).fill(addDays(today, 1));
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task saved.")).toBeVisible();
  await expect(page.getByText(/^Starts /)).toBeVisible();
  const message = page.getByRole("region", { name: "Message" });
  await expect(message).toContainText("Hi Casey");
  await expect(message).toContainText("https://g.page/r/fictional-example");
  await expect(message).toContainText("Rich Example");
  await expect(page.getByRole("link", { name: "Text it" })).toHaveAttribute("href", /^sms:\+17705550150\?&body=Hi%20Casey/);
  expect(await noSidewaysScroll(page)).toBe(true);

  // Today shows the renewal call, not the review request (it hasn't started yet).
  await page.goto("/tasks?view=today");
  const todayList = page.getByRole("list", { name: "Today tasks" });
  await expect(todayList).toContainText("Call about renewal");
  await expect(todayList).not.toContainText("Ask for a review");
  await expect(page.getByRole("link", { name: /Today \(1\)/ })).toBeVisible();
  await page.goto("/tasks?view=upcoming");
  await expect(page.getByRole("list", { name: "Upcoming tasks" })).toContainText("Ask for a review");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Complete from the list, find it under Completed, reopen it.
  await page.goto("/tasks?view=today");
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  await expect(page.getByText("Nothing due today.")).toBeVisible();
  await page.goto("/tasks?view=done");
  await page.getByRole("link", { name: "Call about renewal" }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Task reopened.")).toBeVisible();

  // Log an activity; a requested follow-up needs its date.
  await page.goto(contactUrl);
  await page.getByText("Log activity…").click();
  await page.getByLabel("Outcome", { exact: false }).selectOption({ label: "Asked for a follow-up on a date" });
  await page.getByLabel("Notes", { exact: false }).fill("Wants to talk after the holidays");
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await expect(page.getByText("Enter the date they asked you to follow up.")).toBeVisible();
  await page.getByLabel("Follow up on").fill(addDays(today, 20));
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  await expect(page.getByText("Activity logged.")).toBeVisible();

  // Complete the task from the contact page; both appear in the history.
  await page.getByRole("list", { name: "Open tasks for this contact" }).getByRole("listitem").filter({ hasText: "Call about renewal" })
    .getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  const history = page.getByRole("list", { name: "History for this contact" });
  await expect(history).toContainText("Call — Asked for a follow-up on a date");
  await expect(history).toContainText("Wants to talk after the holidays");
  await expect(history).toContainText("Task completed: Call about renewal");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Another account cannot open the task.
  const taskUrl = await page.getByRole("link", { name: "Task completed: Call about renewal" }).getAttribute("href");
  const stranger = await createTestUser("e2e-tasks-stranger");
  const strangerContext = await browser.newContext({ baseURL: APP_URL });
  await strangerContext.addCookies(await fullSessionCookies(stranger.email, APP_URL));
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(taskUrl!);
  await expect(strangerPage.getByRole("heading", { name: "Task not found" })).toBeVisible();
  await strangerPage.goto(`${taskUrl}/edit`);
  await expect(strangerPage.getByRole("heading", { name: "Task not found" })).toBeVisible();
  await strangerContext.close();
});
