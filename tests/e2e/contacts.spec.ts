import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 3 contact management on a phone-sized screen, with a real two-step session.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("add, validate, de-duplicate, refer, search, edit, archive and restore contacts", async ({ page, context, browser }) => {
  const owner = await createTestUser("e2e-contacts");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  await page.goto("/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("No contacts yet.")).toBeVisible();

  // Validation: no name → field error, typed values kept.
  await page.getByRole("link", { name: "Add contact" }).click();
  await page.getByLabel("Phone", { exact: false }).first().fill("(770) 555-0101");
  await page.getByLabel("Status").selectOption({ label: "Client" });
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Enter a first or last name.")).toBeVisible();
  await expect(page.getByLabel("Phone", { exact: false }).first()).toHaveValue("(770) 555-0101");
  // Choices survive the error (React would otherwise reset the form to its first defaults).
  await expect(page.getByLabel("Status")).toHaveValue("client");

  // Quick add.
  await page.getByLabel("First name").fill("Avery");
  await page.getByLabel("Last name").fill("Example");
  await page.getByLabel("Email", { exact: false }).fill("Avery@Example.com");
  await page.getByLabel("Lead source", { exact: false }).fill("Referral");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avery Example" })).toBeVisible();
  await expect(page.getByRole("link", { name: "770-555-0101" })).toBeVisible();
  await expect(page.getByRole("link", { name: "avery@example.com" })).toBeVisible();
  const averyUrl = page.url();

  // Duplicate warning (same phone, different format), then save anyway.
  await page.goto("/contacts/new");
  await page.getByLabel("First name").fill("Avery");
  await page.getByLabel("Last name").fill("Duplicate");
  await page.getByLabel("Phone", { exact: false }).first().fill("770.555.0101");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("You may already have this contact")).toBeVisible();
  await expect(page.getByRole("link", { name: "Avery Example" })).toBeVisible();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const duplicateUrl = page.url();

  // Business referred by Avery.
  await page.goto("/contacts/new");
  await page.getByLabel("Business", { exact: true }).check();
  await page.getByLabel("Business name").fill("Example Hardware LLC");
  await page.getByText("More details").click();
  // The full form fits an iPhone screen: no sideways scrolling (which also zooms the page out).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Typing a referrer without picking one is refused, not silently dropped.
  await page.getByPlaceholder("Search contacts by name, phone or email").fill("Avery Ex");
  await expect(page.getByRole("button", { name: /Avery Example/ })).toBeVisible();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Tap the referrer in the list under the box, or clear the box.")).toBeVisible();
  await page.getByRole("button", { name: /Avery Example/ }).click();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Avery Example" })).toBeVisible(); // "Referred by"

  await page.goto(averyUrl);
  await expect(page.getByRole("link", { name: "Example Hardware LLC", exact: true })).toBeVisible(); // referrals list
  // Phase 27: the referrer gets a thank-you task (a call or note).
  await expect(page.getByRole("link", { name: "Thank Avery Example for referring Example Hardware LLC" })).toBeVisible();

  // Search and filter.
  await page.goto("/contacts?q=hardware");
  const list = page.getByRole("list", { name: "Contacts" });
  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(list).toContainText("Example Hardware LLC");
  await page.goto("/contacts?type=individual");
  await expect(list.getByRole("link")).toHaveCount(2);
  await page.goto("/contacts?q=5550101");
  await expect(list.getByRole("link")).toHaveCount(2);

  // Edit: make Avery a client.
  await page.goto(averyUrl);
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Status").selectOption("client");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await expect(page.getByText("Client", { exact: true })).toBeVisible();

  // Archive the duplicate: hidden by default, visible with the filter, then restore.
  await page.goto(duplicateUrl);
  await page.getByText("Archive…").click();
  await page.getByRole("button", { name: "Archive contact" }).click();
  await expect(page.getByText("Contact archived.")).toBeVisible();
  await page.goto("/contacts");
  await expect(page.getByRole("list", { name: "Contacts" })).not.toContainText("Avery Duplicate");
  await page.goto("/contacts?archived=archived");
  await expect(page.getByRole("list", { name: "Contacts" })).toContainText("Avery Duplicate");
  await page.goto(duplicateUrl);
  await page.getByRole("button", { name: "Restore contact" }).click();
  await expect(page.getByText("Contact restored.")).toBeVisible();

  // Another account cannot open this contact by URL.
  const stranger = await createTestUser("e2e-stranger");
  const strangerContext = await browser.newContext({ baseURL: APP_URL });
  await strangerContext.addCookies(await fullSessionCookies(stranger.email, APP_URL));
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(averyUrl);
  await expect(strangerPage.getByRole("heading", { name: "Contact not found" })).toBeVisible();
  await strangerPage.goto(`${new URL(averyUrl).pathname}/edit`);
  await expect(strangerPage.getByRole("heading", { name: "Contact not found" })).toBeVisible();
  await strangerContext.close();
});
