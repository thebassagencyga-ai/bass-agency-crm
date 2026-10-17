import { expect, test } from "@playwright/test";
import { todayInZone, addDays } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 18: create a calendar link in Settings, read the feed as a calendar app would (no
// cookies), see a task leave it when done, replace and turn off the link. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("calendar link: create, feed shows open tasks with client names, replace, turn off", async ({ page, context, playwright }) => {
  const owner = await createTestUser("e2e-calendar");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const { data: contact } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Robin", last_name: "Example" }).select("id").single();
  const due = addDays(todayInZone("America/New_York"), 2);
  const { data: task } = await api.from("tasks").insert({ contact_id: contact!.id, title: "Call about the home quote", due_date: due }).select("id").single();

  await page.goto("/settings#calendar");
  const panel = page.locator("#calendar");
  await panel.getByRole("button", { name: "Create calendar link" }).click();
  await expect(panel.getByText("Your calendar link is ready.")).toBeVisible();
  const url = await panel.getByLabel("Link", { exact: false }).inputValue();
  expect(url).toMatch(/\/calendar\/[0-9a-f]{64}\.ics$/);
  await expect(panel.getByRole("link", { name: "Add to iPhone Calendar" })).toHaveAttribute("href", url.replace(/^https?:/, "webcal:"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A calendar app: no cookies at all.
  const calendarApp = await playwright.request.newContext();
  const res = await calendarApp.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  expect(res.headers()["cache-control"]).toContain("no-store");
  const ics = await res.text();
  expect(ics).toContain("SUMMARY:Call about the home quote — Robin Example");
  expect(ics).toContain(`DTSTART;VALUE=DATE:${due.replace(/-/g, "")}`);
  expect(ics).toContain(`/tasks/${task!.id}`);

  // Done tasks leave the feed.
  await api.from("tasks").update({ status: "completed" }).eq("id", task!.id);
  expect(await (await calendarApp.get(url)).text()).not.toContain("Call about the home quote");

  // After a reload the link is no longer shown; it can be replaced (old one stops) or turned off.
  await page.goto("/settings#calendar");
  await expect(panel.getByText("On since", { exact: false })).toBeVisible();
  await expect(panel.getByText("Last checked by your calendar", { exact: false })).toBeVisible();
  await expect(panel.getByLabel("Link", { exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "Replace link" }).click();
  await expect(panel.getByText("Your calendar link is ready.")).toBeVisible();
  const newUrl = await panel.getByLabel("Link", { exact: false }).inputValue();
  expect(newUrl).not.toBe(url);
  expect((await calendarApp.get(url)).status()).toBe(404);
  expect((await calendarApp.get(newUrl)).status()).toBe(200);
  await panel.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("The calendar link is off.", { exact: false })).toBeVisible();
  expect((await calendarApp.get(newUrl)).status()).toBe(404);
  await calendarApp.dispose();
});
