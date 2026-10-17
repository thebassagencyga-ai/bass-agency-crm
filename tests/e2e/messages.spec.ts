import { expect, test } from "@playwright/test";
import { addDays, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 16: text or email from the CRM through the phone's own apps, then log it; and the
// 7-day inactivity sign-out. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("renewal check-in by text: composer, device links, log the text", async ({ page, context }) => {
  const owner = await createTestUser("e2e-messages");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const { data: stage } = await api.from("pipeline_stages").select("id").eq("product_line", "auto").eq("kind", "won").limit(1).single();
  const { data: contact } = await api.from("contacts")
    .insert({ contact_type: "individual", first_name: "Robin", last_name: "Example", phone: "404-555-0101", email: "robin@example.com" })
    .select("id").single();
  const renews = addDays(todayInZone("America/New_York"), 25);
  await api.from("opportunities").insert({ contact_id: contact!.id, product_line: "auto", stage_id: stage!.id, outcome: "won", renewal_date: renews });

  // The phone's apps can't open in the test browser; keep the link click inside the page.
  await page.addInitScript(() => {
    document.addEventListener("click", (e) => {
      if ((e.target as Element | null)?.closest?.('a[href^="sms:"], a[href^="mailto:"], a[href^="tel:"]')) e.preventDefault();
    }, true);
  });

  await page.goto("/renewals?days=30");
  await page.getByRole("link", { name: "Text or email Robin Example" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("renewal");
  const body = page.getByLabel("Text", { exact: true });
  await expect(body).toHaveValue(/^Hi Robin, this is .+\. Your auto policy renews on .+\. I'd like to do a quick review/);
  await expect(page.getByLabel("Email subject")).toHaveValue(/^Your auto policy renews on /);

  // Edited text goes into both links.
  await body.fill("Hi Robin, quick question about your renewal & coverage?");
  const text = page.getByRole("link", { name: "Text", exact: true });
  await expect(text).toHaveAttribute("href", "sms:+14045550101?&body=Hi%20Robin%2C%20quick%20question%20about%20your%20renewal%20%26%20coverage%3F");
  await expect(page.getByRole("link", { name: "Email", exact: true })).toHaveAttribute("href", /^mailto:robin@example\.com\?subject=Your%20auto%20policy%20renews%20on%20.+&body=Hi%20Robin%2C%20quick/);
  await expect(page.getByRole("link", { name: "Call", exact: true })).toHaveAttribute("href", "tel:+14045550101");

  // Another template replaces the text.
  await page.getByLabel("Message", { exact: true }).selectOption({ label: "Thank you" });
  await expect(body).toHaveValue(/^Hi Robin, thank you for choosing us/);
  await page.getByLabel("Message", { exact: true }).selectOption({ label: "Renewal check-in" });

  // After opening Messages: log it.
  await text.click();
  await page.getByRole("link", { name: "Log this text" }).click();
  await expect(page.getByLabel("What happened")).toHaveValue("text_message");
  await expect(page.getByLabel("Notes")).toHaveValue("Texted: Renewal check-in.");
  await expect(page.getByLabel("About opportunity")).not.toHaveValue("");
  await page.getByRole("button", { name: "Log activity" }).click();
  await expect(page.getByText("Activity logged.")).toBeVisible();
  await expect(page.getByRole("list", { name: "History for this contact" })).toContainText("Text message (logged)");
  await expect(page.getByRole("list", { name: "History for this contact" })).toContainText("Texted: Renewal check-in.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a session with no visit for 7 days is signed out and told why", async ({ page, context }) => {
  const owner = await createTestUser("e2e-idle");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  const { hostname } = new URL(APP_URL);
  await context.addCookies([{ name: "crm_seen", value: String(Math.floor(Date.now() / 1000) - 8 * 86_400), domain: hostname, path: "/" }]);
  await page.goto("/contacts");
  await expect(page).toHaveURL(/\/login\?expired=1&next=%2Fcontacts$/);
  await expect(page.getByText("You were signed out because the CRM wasn't used for 7 days.", { exact: false })).toBeVisible();
  // The old session is gone for good: going back does not get in.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});
