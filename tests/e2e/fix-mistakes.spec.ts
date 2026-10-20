import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies, ownStage } from "../support/supabase";

// Phase 29 (ADR-047): colour on the board and tags; correcting a deal's line; marking a won sale
// as an existing policy; removing a deal entered by mistake. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("fix mistakes on deals, with colour on the board and line tags", async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = await createTestUser("e2e-fix");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  await api.from("tag_options").insert({ name: "Auto" });
  const { data: c } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Kerry", last_name: "Example", tags: ["Auto"], relationship_status: "client" }).select("id").single();
  const { data: wrong } = await api.from("opportunities").insert({ contact_id: c!.id, product_line: "home", stage_id: await ownStage(api, "home", "contacted") }).select("id").single();
  const { data: sale } = await api.from("opportunities").insert({ contact_id: c!.id, product_line: "auto", stage_id: await ownStage(api, "auto", "bound"), outcome: "won", estimated_annual_premium: 1597 }).select("id").single();
  const { data: test1 } = await api.from("opportunities").insert({ contact_id: c!.id, product_line: "auto", stage_id: await ownStage(api, "auto", "new_lead"), description: "Test" }).select("id").single();

  // Colour: Won and working stages differ; the card carries a line chip; the Auto tag is tinted.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/opportunities?line=auto");
  const bg = (name: RegExp) => page.getByRole("heading", { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
  const [won, working] = [await bg(/^Bound/), await bg(/^New Lead/)];
  expect(won).not.toBe(working);
  expect(won).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator(`#opp-${sale!.id}`).getByText("Auto", { exact: true })).toBeVisible();
  await page.goto("/contacts?tab=clients");
  const tag = page.getByRole("list", { name: "Tags" }).first().getByText("Auto", { exact: true });
  expect(await tag.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(224, 239, 255)");

  // An auto deal saved as home: change the line.
  await page.goto(`/opportunities/${wrong!.id}`);
  await page.getByText("Fix a mistake…").click();
  await page.getByLabel("Correct line").selectOption({ label: "Auto" });
  await page.getByRole("button", { name: "Change line" }).click();
  await expect(page.getByText("Line changed.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Auto");

  // A client's existing policy entered as a sale: off the board.
  await page.goto("/opportunities?line=auto");
  await expect(page.locator(`#opp-${sale!.id}`)).toBeVisible();
  await page.goto(`/opportunities/${sale!.id}`);
  await page.getByText("Fix a mistake…").click();
  await page.getByRole("button", { name: "This was a policy they already had" }).click();
  await expect(page.getByText("Marked as a policy they already had", { exact: false })).toBeVisible();
  await page.goto("/opportunities?line=auto");
  await expect(page.locator(`#opp-${sale!.id}`)).toHaveCount(0);

  // A test deal: removing needs the confirmation tick; then it is gone from the app.
  await page.goto(`/opportunities/${test1!.id}`);
  await page.getByText("Fix a mistake…").click();
  await page.getByRole("button", { name: "Remove (entered by mistake)" }).click();
  await expect(page.getByText("Tick the box to confirm", { exact: false })).toBeVisible();
  await page.getByLabel("Yes, remove this deal").check();
  await page.getByRole("button", { name: "Remove (entered by mistake)" }).click();
  await expect(page.getByText("Deal removed.", { exact: false })).toBeVisible();
  await page.goto(`/opportunities/${test1!.id}`);
  await expect(page.getByRole("heading", { name: "Opportunity not found" })).toBeVisible();
  const { data: rows } = await api.from("opportunities").select("id").eq("id", test1!.id);
  expect(rows).toEqual([]);
});
