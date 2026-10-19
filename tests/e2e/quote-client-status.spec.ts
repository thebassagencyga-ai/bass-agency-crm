import { expect, test } from "@playwright/test";
import { addDays, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 23 (ADR-039): moving into a quote stage records the quote date (editable on the
// opportunity page, today from the board) and schedules exactly one quote follow-up; binding
// makes the contact a client. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("quote date on quote stages, one follow-up, client on bind", async ({ page, context }) => {
  const owner = await createTestUser("e2e-quote-status");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");
  const yesterday = addDays(today, -1);

  const { data: contact } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Robin", last_name: "Example" }).select("id").single();
  const stage = async (line: string, code: string) =>
    (await api.from("pipeline_stages").select("id").eq("product_line", line).eq("code", code).single()).data!.id as string;
  const { data: auto } = await api.from("opportunities")
    .insert({ contact_id: contact!.id, product_line: "auto", stage_id: await stage("auto", "contacted") }).select("id").single();
  const { data: home } = await api.from("opportunities")
    .insert({ contact_id: contact!.id, product_line: "home", stage_id: await stage("home", "contacted") }).select("id").single();
  const followUps = async (oppId: string) =>
    (await api.from("tasks").select("id").eq("opportunity_id", oppId).eq("title", "Follow up on quote")).data!.length;
  const quoteDate = async (oppId: string) =>
    (await api.from("opportunities").select("quote_sent_on").eq("id", oppId).single()).data!.quote_sent_on as string | null;

  // Opportunity page: choosing Quoted asks for the quote date, today by default, editable.
  await page.goto(`/opportunities/${auto!.id}`);
  const quoteField = page.getByLabel("Quote sent on");
  await expect(quoteField).toHaveCount(0);
  await page.getByLabel("Move to stage").selectOption({ label: "Quoted" });
  await expect(quoteField).toHaveValue(today);
  await quoteField.fill(yesterday);
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  expect(await quoteDate(auto!.id)).toBe(yesterday);
  expect(await followUps(auto!.id)).toBe(1);

  // Moving on and back keeps the date and adds no second follow-up.
  await page.getByLabel("Move to stage").selectOption({ label: "Follow Up" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: "Quoted" });
  await expect(quoteField).toHaveValue(yesterday);
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  expect(await quoteDate(auto!.id)).toBe(yesterday);
  expect(await followUps(auto!.id)).toBe(1);

  // Board move to Quoted records today.
  await page.goto("/opportunities?line=home");
  await page.getByLabel("Move Robin Example to stage").selectOption({ label: "Quoted" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  expect(await quoteDate(home!.id)).toBe(today);
  expect(await followUps(home!.id)).toBe(1);

  // Binding makes the prospect a client.
  await page.goto(`/contacts/${contact!.id}`);
  await expect(page.getByText("Prospect", { exact: true }).first()).toBeVisible();
  await page.goto(`/opportunities/${auto!.id}`);
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.")).toBeVisible();
  await page.goto(`/contacts/${contact!.id}`);
  await expect(page.getByText("Client", { exact: true }).first()).toBeVisible();
});
