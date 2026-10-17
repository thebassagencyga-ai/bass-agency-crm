import { expect, test } from "@playwright/test";
import { seededOwner } from "./support/seed";

// Phase 19: the AI helpers are built but not connected (no ANTHROPIC_API_KEY in this build).
// Nothing AI shows anywhere, and Settings says how to connect. The helpers themselves are
// covered by unit tests against a fake API (tests/unit/ai*.test.ts).
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("AI helpers stay hidden until connected", async ({ page, context }) => {
  const owner = await seededOwner("e2e-ai", APP_URL);
  await context.addCookies(owner.cookies);

  await page.goto("/settings#ai");
  const panel = page.locator("#ai");
  await expect(panel.getByRole("heading", { name: "AI helpers" })).toBeVisible();
  await expect(panel.getByText("Not connected.", { exact: false })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Daily briefing" })).toHaveCount(0);

  await page.goto(`/contacts/${owner.contactId}?message=checkin`);
  await expect(page.getByText("Draft with AI", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Fill in from my notes (AI)", { exact: false })).toHaveCount(0);

  await page.goto("/import");
  await expect(page.getByRole("button", { name: "Suggest matches with AI" })).toHaveCount(0);
});
