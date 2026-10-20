import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { addDays, formatDateOnly, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies, ownStage } from "../support/supabase";

// Phase 27 (ADR-045): ProducrIQ Focus on the Today page, on an iPhone-sized screen with a real
// two-step session. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
// The local Supabase stack's database (never production). Only used to make deals look older:
// the added and stage-change times are set by the database and cannot be backdated through the app.
const LOCAL_DB_URL = process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function makeOlder(ids: string[], days: number) {
  const db = new pg.Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  try {
    await db.query("begin");
    // Both keep these times as the database set them: pause them for this one update.
    await db.query("alter table public.opportunities disable trigger opportunities_focus_fields");
    await db.query("alter table public.opportunities disable trigger opportunities_touch");
    await db.query(
      `update public.opportunities set created_at = created_at - make_interval(days => $2), stage_changed_at = stage_changed_at - make_interval(days => $2)
        where id = any($1::uuid[])`, [ids, days]);
    await db.query("alter table public.opportunities enable trigger opportunities_focus_fields");
    await db.query("alter table public.opportunities enable trigger opportunities_touch");
    await db.query("commit");
  } finally {
    await db.end();
  }
}

test("Focus lists quiet deals with the reason; snoozing or logging activity takes them off", async ({ page, context }) => {
  const owner = await createTestUser("e2e-focus-quiet");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");

  const { data: jordan } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Jordan", last_name: "Example", phone: "404-555-0101" }).select("id").single();
  const { data: morgan } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Morgan", last_name: "Test", phone: "404-555-0103" }).select("id").single();
  const { data: quote } = await api.from("opportunities").insert({
    contact_id: jordan!.id, product_line: "auto", stage_id: await ownStage(api, "auto", "quoted"), quote_sent_on: addDays(today, -6), estimated_annual_premium: 2340,
  }).select("id").single();
  const { data: open } = await api.from("opportunities").insert({
    contact_id: morgan!.id, product_line: "home", stage_id: await ownStage(api, "home", "contacted"),
  }).select("id").single();
  await makeOlder([quote!.id, open!.id], 9);

  await page.goto("/dashboard");
  const focus = page.getByRole("region", { name: "Focus" });
  await expect(focus).toContainText("2 items need you.");
  const quotes = focus.getByRole("list", { name: "Quotes gone quiet" });
  await expect(quotes).toContainText("Jordan Example");
  await expect(quotes).toContainText("Auto · Quoted · $2,340/yr");
  await expect(quotes).toContainText(`Quote sent ${formatDateOnly(addDays(today, -6))}. Nothing logged in 6 days.`);
  await expect(quotes.getByRole("link", { name: "Call Jordan Example" })).toHaveAttribute("href", "tel:+14045550101");
  await expect(quotes.getByRole("link", { name: "Text Jordan Example" })).toHaveAttribute("href", /^sms:\+14045550101/);
  await expect(quotes.getByRole("link", { name: "Log activity" })).toHaveAttribute("href", `/contacts/${jordan!.id}#log-activity`);
  const quiet = focus.getByRole("list", { name: "Open deals gone quiet" });
  await expect(quiet).toContainText("Morgan Test");
  await expect(quiet).toContainText("Nothing logged in 9 days.");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Snooze a week: gone from Focus until then.
  await quiet.getByRole("button", { name: "Snooze Morgan Test for 1 week" }).click();
  await expect(page.getByText("Snoozed. It comes back if it is still quiet then.")).toBeVisible();
  await expect(focus.getByRole("list", { name: "Open deals gone quiet" })).toHaveCount(0);
  const { data: snoozed } = await api.from("opportunities").select("focus_snoozed_until").eq("id", open!.id).single();
  expect(snoozed!.focus_snoozed_until).toBe(addDays(today, 7));

  // A logged call takes the quote off the list; then Focus is clear.
  await api.from("activities").insert({ contact_id: jordan!.id, opportunity_id: quote!.id, activity_type: "call", outcome: "connected" });
  await page.reload();
  await expect(focus).toContainText("All clear. No deal needs you right now.");
});

test("re-quote, thank-you and nurture check-backs: set on the deal, shown and cleared in Focus", async ({ page, context }) => {
  const owner = await createTestUser("e2e-focus-tasks");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");

  // A referral: the referrer is thanked by call or note.
  const { data: riley } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Riley", last_name: "Sample", phone: "404-555-0106" }).select("id").single();
  const { data: jamie } = await api.from("contacts").insert({
    contact_type: "individual", first_name: "Jamie", last_name: "Example", phone: "404-555-0107", referred_by_contact_id: riley!.id,
  }).select("id").single();
  await page.goto("/dashboard");
  const focus = page.getByRole("region", { name: "Focus" });
  const thanks = focus.getByRole("list", { name: "Say thank you" });
  await expect(thanks).toContainText("Riley Sample");
  await expect(thanks).toContainText("Thank Riley Sample for referring Jamie Example");
  await thanks.getByRole("button", { name: "Mark thanked: Riley Sample" }).click();
  await expect(page.getByText("Task completed.")).toBeVisible();
  await expect(focus.getByRole("list", { name: "Say thank you" })).toHaveCount(0);

  // Current coverage on the deal page, with the re-quote preview; 30 days out is due today.
  const { data: deal } = await api.from("opportunities").insert({
    contact_id: jamie!.id, product_line: "auto", stage_id: await ownStage(api, "auto", "contacted"),
  }).select("id").single();
  await page.goto(`/opportunities/${deal!.id}`);
  const coverage = page.getByRole("region", { name: "Current coverage elsewhere" });
  await coverage.getByLabel("Current carrier").fill("Example Mutual");
  await coverage.getByLabel("Renews on").fill(addDays(today, 30));
  await expect(coverage.getByRole("status")).toHaveText(`Shows in Focus on ${formatDateOnly(today)} (today): 45 days before it renews.`);
  await coverage.getByRole("button", { name: "Save coverage" }).click();
  await expect(page.getByText("Current coverage saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks for this opportunity" })).toContainText("Re-quote before their current policy renews");

  await page.goto("/dashboard");
  const requote = focus.getByRole("list", { name: "Time to re-quote" });
  await expect(requote).toContainText(`Current policy with Example Mutual renews ${formatDateOnly(addDays(today, 30))}.`);
  await requote.getByRole("button", { name: "Not this year: Jamie Example" }).click();
  await expect(page.getByText("Task closed.")).toBeVisible();
  await expect(focus.getByRole("list", { name: "Time to re-quote" })).toHaveCount(0);

  // Nurture asks when to check back: a picked date must be after today; 30 days by default.
  await page.goto(`/opportunities/${deal!.id}`);
  await page.getByText("Move to nurture…").click();
  await page.getByLabel("Check back", { exact: true }).selectOption({ label: "Pick a date" });
  await page.getByLabel("Check back on").fill(today);
  await page.getByRole("button", { name: "Move to nurture" }).click();
  await expect(page.getByText("Pick a date after today.")).toBeVisible();
  await page.getByLabel("Check back", { exact: true }).selectOption({ label: "In 30 days" });
  await page.getByRole("button", { name: "Move to nurture" }).click();
  await expect(page.getByText("Moved to nurture. A check-back task was added for the date you chose.")).toBeVisible();
  await expect(page.getByText(formatDateOnly(addDays(today, 30)), { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks for this opportunity" })).toContainText("Check back (nurture)");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Not in Focus until the date; on the date it is listed with a way to pick a new one.
  await page.goto("/dashboard");
  await expect(focus.getByRole("list", { name: "Nurture check-backs" })).toHaveCount(0);
  await api.from("opportunities").update({ nurture_check_back_on: today }).eq("id", deal!.id);
  await page.reload();
  const nurture = focus.getByRole("list", { name: "Nurture check-backs" });
  await expect(nurture).toContainText("Check back today.");
  await expect(nurture.getByRole("link", { name: "New date" })).toHaveAttribute("href", `/opportunities/${deal!.id}#nurture`);
});
