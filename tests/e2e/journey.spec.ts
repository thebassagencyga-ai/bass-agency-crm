import { expect, test } from "@playwright/test";
import { addDays, addMonths, formatDateOnly, todayInZone } from "../../src/lib/dates";
import { PASSWORD, anonClient, createTestUser, enrollTotp } from "../support/supabase";
import { totp, waitForNextTotpWindow } from "../support/totp";

// Phase 11: the whole sales journey in one go, on a phone-sized screen, signing in for real
// (password + authenticator code): login → add contact → opportunity → automated task →
// quote → automated follow-up → win → renewal → reports → sign out.

test("login → contact → opportunity → quote → automated tasks → win → renewal", async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await createTestUser("e2e-journey");
  const setup = anonClient();
  await setup.auth.signInWithPassword({ email: owner.email, password: PASSWORD });
  const secret = await enrollTotp(setup);
  const today = todayInZone("America/New_York");

  // Sign in: password, then the authenticator code.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa/);
  await waitForNextTotpWindow();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Add a contact.
  await page.getByRole("link", { name: "Add contact" }).click();
  await page.getByLabel("First name").fill("Casey");
  await page.getByLabel("Last name").fill("Journey");
  await page.getByLabel("Phone", { exact: false }).first().fill("(555) 010-0142");
  await page.getByLabel("Lead source", { exact: false }).fill("Referral");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();

  // New auto lead → automatic "Make initial contact" due today.
  await page.getByRole("link", { name: "Add opportunity" }).click();
  await page.getByRole("radio", { name: "Auto", exact: true }).check();
  await page.getByRole("button", { name: "Add opportunity" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  const oppUrl = page.url().split("?")[0]!;
  const oppTasks = page.getByRole("list", { name: "Tasks for this opportunity" });
  await expect(oppTasks).toContainText("Make initial contact");
  await expect(oppTasks).toContainText(`Due ${formatDateOnly(today)}`);

  // Contact made, no quote yet → automatic follow-up in 2 business days.
  await oppTasks.getByRole("link", { name: "Make initial contact" }).click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("Task completed.", { exact: false })).toBeVisible();
  await page.goto(oppUrl);
  await expect(oppTasks).toContainText("Follow up after initial contact");

  // Quote sent today, with premium and renewal date → automatic quote follow-up.
  await page.goto(`${oppUrl}/edit`);
  await page.getByLabel("Quote sent on", { exact: false }).fill(today);
  await page.getByLabel("Estimated annual premium", { exact: false }).fill("1,350");
  await page.getByLabel("Renewal date", { exact: false }).fill(addDays(today, 25));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Opportunity saved.")).toBeVisible();
  await expect(oppTasks).toContainText("Follow up on quote");

  // Win → prospecting tasks closed; onboarding, review and referral tasks added.
  await page.getByLabel("Move to stage").selectOption({ label: "Bound (won)" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Marked as won.", { exact: false })).toBeVisible();
  await expect(oppTasks.getByRole("link", { name: "Follow up on quote" })).toHaveClass(/line-through/);
  for (const t of ["Thank the client", "Ask for a Google review", "Ask for a referral", "Renewal review"]) await expect(oppTasks).toContainText(t);

  // Renewal: listed, renewed, rolled forward a year.
  await page.goto("/renewals?days=30");
  const policies = page.getByRole("list", { name: "Client policies" });
  await expect(policies).toContainText("Casey Journey · Auto");
  await policies.getByRole("link", { name: "Record outcome" }).click();
  await page.getByLabel("Renewed", { exact: true }).check();
  await page.getByRole("button", { name: "Record outcome" }).click();
  await expect(page.getByText("Renewal recorded.", { exact: false })).toBeVisible();
  await page.goto(oppUrl);
  await expect(page.getByText(formatDateOnly(addMonths(addDays(today, 25), 12))).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Renewal history" })).toContainText("Renewed");

  // Reports reflect the win.
  await page.goto("/reports");
  await expect(page.getByRole("region", { name: "Conversion rate" }).getByText("100% (1 of 1 closed)", { exact: true }).first()).toBeVisible();

  // Sign out: the app is closed again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?signedOut=1/);
  await page.goto(oppUrl);
  await expect(page).toHaveURL(/\/login/);
});
