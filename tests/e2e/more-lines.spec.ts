import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 30 (ADR-048): nine more lines, each on the board of a related line. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("a Renters deal sits on the Home board; lines show in forms, quick intake and Settings", async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = await createTestUser("e2e-lines");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const { data: c } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Robin", last_name: "Example" }).select("id").single();

  // New deal: Renters. It lands in the Home pipeline's first stage, with a Renters chip.
  await page.goto(`/opportunities/new?contact=${c!.id}`);
  await page.getByRole("radio", { name: "Renters" }).check();
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Renters");
  const { data: deals } = await api.from("opportunities").select("id, product_line").eq("contact_id", c!.id);
  expect(deals).toEqual([{ id: expect.any(String), product_line: "renters" }]);

  await page.setViewportSize({ width: 1280, height: 800 });
  const { data: home } = await api.from("pipelines").select("id").eq("name", "Home").single();
  await page.goto(`/opportunities?pipeline=${home!.id}`);
  const card = page.locator(`#opp-${deals![0]!.id}`);
  await expect(card.getByText("Renters", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^New Lead/ })).toBeVisible();

  // Change line now offers every line; Motorcycle allows a 6-month term.
  await page.goto(`/opportunities/${deals![0]!.id}`);
  await page.getByText("Fix a mistake…").click();
  const lines = await page.getByLabel("Correct line").locator("option").allTextContents();
  expect(lines).toEqual(expect.arrayContaining(["Motorcycle", "Boat", "RV", "Renters", "Condo", "Mobile Home", "Umbrella", "Commercial Auto", "Farm"]));
  await page.goto(`/opportunities/new?contact=${c!.id}`);
  await page.getByRole("radio", { name: "Motorcycle" }).check();
  await page.getByText("Quote and policy dates", { exact: true }).click();
  await expect(page.getByLabel("Policy term")).toBeVisible();
  await page.getByRole("radio", { name: "Boat" }).check();
  await expect(page.getByLabel("Policy term")).toHaveCount(0);

  // Quick intake (same form as the public quote page) lists the new lines.
  await page.goto("/intake/new");
  for (const name of ["Umbrella", "Commercial Auto", "Mobile Home"]) await expect(page.getByRole("checkbox", { name })).toBeVisible();

  // Settings → Commission: one rate row per line.
  await page.goto("/settings/production");
  await expect(page.getByLabel("Umbrella new-business rate, percent")).toBeVisible();
  await expect(page.getByLabel("Farm renewal rate, percent")).toBeVisible();
});
