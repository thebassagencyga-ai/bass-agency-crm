import { expect, test, type Page } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 13 intake form on a phone-sized screen: the agent creates a link, a prospect (signed
// out, separate browser) sends a request, the agent reviews and accepts it; then quick intake.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("public intake link → review inbox → accept; quick intake; link off and replaced", async ({ page, context, browser }) => {
  const owner = await createTestUser("e2e-intake");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  // Settings: create the link; it shows with a QR code.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Create my form link" }).click();
  await expect(page.getByText("Your new link is ready.")).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code for the intake form link" })).toBeVisible();
  const link = await page.locator("#intake a[href*='/quote/']").getAttribute("href");
  expect(link).toMatch(/\/quote\/[0-9a-f]{32}$/);
  const quotePath = new URL(link!).pathname;

  // A prospect, signed out, in another browser context.
  const visitor = await browser.newContext({ ...test.info().project.use });
  const form = await visitor.newPage();
  await form.goto(`${APP_URL}${quotePath}`);
  await expect(form.getByRole("heading", { name: "Request an insurance quote" })).toBeVisible();
  expect(await noSidewaysScroll(form)).toBe(true);

  // Validation: nothing filled in.
  await form.getByRole("button", { name: "Send my request" }).click();
  await expect(form.getByText("Enter a first name.")).toBeVisible();
  await expect(form.getByText("Choose at least one type of insurance.")).toBeVisible();
  await expect(form.getByText("Please tick the box so we may contact you.")).toBeVisible();

  await form.getByLabel("First name").fill("Jordan");
  await form.getByLabel("Last name").fill("Example");
  await form.getByRole("textbox", { name: /^Phone/ }).fill("404 555 0177");
  await form.getByRole("textbox", { name: /^Email/ }).fill("jordan@example.com");
  await form.getByLabel("Street address", { exact: false }).fill("1 Example St");
  await form.getByLabel("City", { exact: false }).fill("Carrollton");
  await expect(form.getByLabel("State", { exact: false })).toHaveValue("GA");
  await form.getByLabel("ZIP", { exact: false }).fill("30117");
  await form.getByRole("checkbox", { name: "Auto", exact: true }).check();
  await form.getByRole("checkbox", { name: "Home", exact: true }).check();
  await form.getByLabel("Auto: current company", { exact: false }).fill("Example Mutual");
  await form.locator("#renews_auto").selectOption({ label: "March" });
  // Vehicles appear because Auto is ticked; one bad year is explained, then fixed.
  await form.getByLabel("Vehicle 1 year", { exact: false }).fill("1850");
  await form.locator("#veh_make_0").fill("Example");
  await form.locator("#veh_model_0").fill("Sedan");
  await form.getByRole("button", { name: "Add a person" }).click();
  await form.getByLabel("Person 1 first name", { exact: false }).fill("Sam");
  await form.locator("#hh_last_0").fill("Example");
  await form.locator("#hh_rel_0").selectOption({ label: "Spouse or partner" });
  await form.getByLabel("How did you hear about us?", { exact: false }).selectOption("Referral");
  await form.getByLabel("Who referred you?", { exact: false }).fill("Casey Sample");
  await form.getByRole("checkbox", { name: /I agree that The Bass Agency may contact me/ }).check();
  expect(await noSidewaysScroll(form)).toBe(true);
  await form.getByRole("button", { name: "Send my request" }).click();
  await expect(form.getByText(/Enter a year from 1900 to \d{4}\./)).toBeVisible();
  // Typed rows survive the error.
  await expect(form.locator("#hh_first_0")).toHaveValue("Sam");
  await form.getByLabel("Vehicle 1 year", { exact: false }).fill("2019");
  await form.getByRole("button", { name: "Send my request" }).click();
  await expect(form.getByText("Thank you — we have your request.")).toBeVisible();

  // The agent: dashboard badge → inbox → review.
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "New quote requests (1)" }).click();
  await expect(page.getByRole("heading", { name: "Intake" })).toBeVisible();
  await page.getByRole("link", { name: /Jordan Example/ }).click();
  await expect(page.getByRole("heading", { name: "Jordan Example" })).toBeVisible();
  await expect(page.getByText("Auto: Example Mutual, renews in March")).toBeVisible();
  await expect(page.getByText("Casey Sample").first()).toBeVisible();
  await expect(page.getByText("1 Example St, Carrollton, GA 30117")).toBeVisible();
  await expect(page.getByText("2019 Example Sedan")).toBeVisible();
  await expect(page.getByText("Sam Example (Spouse or partner)")).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Accept and add to CRM" }).click();
  await expect(page.getByText("Added to the CRM.")).toBeVisible();
  await expect(page.getByText("No new requests.")).toBeVisible();
  await page.getByRole("link", { name: "Open the contact" }).click();
  await expect(page.getByRole("heading", { name: "Jordan Example" })).toBeVisible();
  const opportunities = page.getByRole("list", { name: "Opportunities for this contact" });
  await expect(opportunities).toContainText("Auto");
  await expect(opportunities).toContainText("Home");
  await expect(page.getByRole("list", { name: "Household members" })).toContainText("Sam Example");
  await expect(page.getByRole("list", { name: "Vehicles" })).toContainText("2019 Example Sedan");
  expect(await noSidewaysScroll(page)).toBe(true);

  // Edit a vehicle, add and remove a household member, on the contact page.
  await page.getByText("Edit 2019 Example Sedan").click();
  await page.locator("#vehicles").getByLabel("Model", { exact: false }).first().fill("Wagon");
  await page.getByRole("button", { name: "Save vehicle" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Vehicles" })).toContainText("2019 Example Wagon");
  await page.locator("#household").getByText("Add a person").click();
  await page.locator("#hh-first-new").fill("Kit");
  await page.locator("#hh-rel-new").selectOption({ label: "Child" });
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(page.getByRole("list", { name: "Household members" })).toContainText("Kit");
  await page.getByRole("button", { name: "Remove Kit" }).click();
  await expect(page.getByText("Removed. It is kept in the history, not deleted.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Household members" })).not.toContainText("Kit");

  // Quick intake with the same phone: the duplicate is offered; add to the existing contact.
  await page.goto("/intake/new");
  await page.getByLabel("First name").fill("Jordan");
  await page.getByLabel("Last name").fill("Example");
  await page.getByRole("textbox", { name: /^Phone/ }).fill("404-555-0177");
  await page.getByRole("checkbox", { name: "Life" }).check();
  await page.getByRole("button", { name: "Add to CRM" }).click();
  await expect(page.getByText("You may already have this person")).toBeVisible();
  await page.getByRole("radio", { name: /Add to Jordan Example/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Opportunities for this contact" })).toContainText("Life");

  // Turn the link off: the form refuses; a new link replaces it.
  await page.goto("/settings");
  await page.locator("#intake").getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("The form link is off.")).toBeVisible();
  await form.goto(`${APP_URL}${quotePath}`);
  await form.getByLabel("First name").fill("Late");
  await form.getByLabel("Last name").fill("Example");
  await form.getByRole("textbox", { name: /^Email/ }).fill("late@example.com");
  await form.getByRole("checkbox", { name: "Life" }).check();
  await form.getByRole("checkbox", { name: /I agree that The Bass Agency may contact me/ }).check();
  await form.getByRole("button", { name: "Send my request" }).click();
  await expect(form.getByText("This form link is no longer active.")).toBeVisible();
  await page.locator("#intake").getByRole("button", { name: "New link" }).click();
  await expect(page.getByText("Your new link is ready.")).toBeVisible();
  expect(await page.locator("#intake a[href*='/quote/']").getAttribute("href")).not.toBe(link);
  await visitor.close();
});
