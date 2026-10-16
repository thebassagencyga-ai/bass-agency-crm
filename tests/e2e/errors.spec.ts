import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 11 error handling: unknown pages and records give a clear 404 that never reveals
// whether a record exists for someone else; bad input is rejected with field messages.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("unknown pages and records: friendly 404, same for someone else's record", async ({ page, context }) => {
  test.setTimeout(180_000);
  const owner = await createTestUser("e2e-errors");
  const other = await createTestUser("e2e-errors-other");
  const theirs = await fullSessionClient(other.email);
  const { data: theirContact } = await theirs.from("contacts").insert({ contact_type: "individual", first_name: "Private" }).select("id").single();
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const missing = randomUUID();
  for (const [path, heading] of [
    ["/contacts/not-a-uuid", "Contact not found"],
    [`/contacts/${missing}`, "Contact not found"],
    [`/contacts/${theirContact!.id as string}`, "Contact not found"], // exists, but not this owner's: same answer
    [`/opportunities/${missing}`, /not found/i],
    [`/tasks/${missing}`, /not found/i],
    [`/renewals/${missing}`, "Page not found"],
  ] as const) {
    // Record pages stream (they have a loading screen), so the HTTP status is already 200 when
    // the record turns out to be missing; what matters is the page shown (Next.js behaviour).
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading }), path).toBeVisible();
    await expect(page.getByText("Private")).toHaveCount(0);
  }
});

test("bad input is refused with field messages, and nothing is saved", async ({ page, context }) => {
  const owner = await createTestUser("e2e-errors-input");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  await page.goto("/contacts/new");
  await page.getByLabel("Email", { exact: false }).fill("not-an-email");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Enter a first or last name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page).toHaveURL(/\/contacts\/new/);

  await page.goto("/contacts");
  await expect(page.getByText("No contacts yet.", { exact: false })).toBeVisible();
});
