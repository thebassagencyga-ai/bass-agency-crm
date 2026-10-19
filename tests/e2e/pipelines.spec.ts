import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 25 (ADR-043): your own pipelines, on a phone-sized screen. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

const noSidewaysScroll = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("create a P&C pipeline for auto and home, route leads there, move a deal, archive the old one", async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = await createTestUser("e2e-pipelines");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);

  // Starting point: today's four pipelines.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Edit pipelines" }).click();
  const list = page.getByRole("list", { name: "Your pipelines" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list).toContainText("New leads: Auto");
  await expect(list).toContainText("New Lead → Contacted → Info Needed → Quoted → Follow Up → Bound → Lost");

  // A P&C pipeline: tick Auto and Home, rename and add stages; a broken list is refused first.
  await page.getByRole("link", { name: "Add a pipeline" }).click();
  await page.getByLabel("Pipeline name").fill("P&C");
  await page.getByRole("checkbox", { name: /Auto/ }).check();
  await page.getByRole("checkbox", { name: /Home/ }).check();
  await page.getByLabel("Stage 2").fill("New Lead");
  await page.getByRole("button", { name: "Save pipeline" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Give each stage a different name." })).toBeVisible();
  await page.getByLabel("Stage 2").fill("Gathering Info");
  await page.getByRole("button", { name: "Add a stage" }).click();
  await page.getByLabel("Stage 5").fill("Underwriting");
  await page.getByRole("button", { name: "Move Underwriting up" }).click();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Save pipeline" }).click();
  await expect(page.getByText("Pipeline saved.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list.getByRole("listitem").filter({ hasText: "P&C" })).toContainText("New leads: Auto, Home");
  await expect(list.getByRole("listitem").filter({ hasText: "P&C" })).toContainText("New Lead → Gathering Info → Quoted → Underwriting → Follow Up → Bound → Lost");

  // A new auto deal goes to P&C by default; the board shows it there with its line.
  const { data: contact } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Jordan", last_name: "Example" }).select("id").single();
  await page.goto(`/opportunities/new?contact=${contact!.id}`);
  await expect(page.getByLabel("Pipeline")).toHaveValue(/.+/);
  await expect(page.getByLabel("Pipeline").locator("option:checked")).toHaveText("P&C");
  await expect(page.getByLabel("Starting stage").locator("option")).toHaveText(["New Lead", "Gathering Info", "Quoted", "Underwriting", "Follow Up"]);
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await expect(page.getByText("PipelineP&C")).toBeVisible();
  const oppUrl = page.url().split("?")[0]!;

  await page.goto("/opportunities");
  await page.getByRole("navigation", { name: "Pipelines" }).getByRole("link", { name: "P&C" }).click();
  await expect(page.getByRole("heading", { name: /New Lead \(1\)/ })).toBeVisible();
  await expect(page.locator("li[id^=opp-]")).toContainText("Auto");

  // Moving to the quote stage asks for the quote date, as before; then into another pipeline.
  await page.goto(oppUrl);
  await page.getByLabel("Move to stage").selectOption({ label: "Quoted" });
  await expect(page.getByLabel("Quote sent on")).toBeVisible();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  await page.getByLabel("Move to stage").selectOption({ label: "Commercial: Discovery" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  await expect(page.getByText("PipelineCommercial")).toBeVisible();
  await expect(page.getByText("Product lineAuto")).toBeVisible();

  // The old Auto pipeline no longer receives leads and holds no deals: archive it.
  await page.goto("/settings/pipelines");
  await page.getByRole("link", { name: "Edit Auto" }).click();
  await expect(page.getByRole("checkbox", { name: /Auto/ })).not.toBeChecked();
  await page.getByText("Archive this pipeline…").click();
  await page.getByRole("button", { name: "Archive pipeline" }).click();
  await expect(page.getByText("Pipeline archived.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByRole("listitem").filter({ hasText: /^Auto/ })).toHaveCount(0);

  // Commercial holds the moved deal: its stage cannot be removed, and archiving is refused.
  await page.getByRole("link", { name: "Edit Commercial" }).click();
  await expect(page.getByText("1 deal here (move them to remove it)")).toBeVisible();
  await page.getByText("Archive this pipeline…").click();
  await page.getByRole("button", { name: "Archive pipeline" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Send its lines to another pipeline before archiving" })).toBeVisible();
});
