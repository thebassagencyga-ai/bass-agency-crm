import { expect, test } from "@playwright/test";
import { addDays, addMonths, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// ADR-042: "Add existing policy" on a contact saves the policy as bound with a past effective
// date, adds only the renewal review, and makes the contact a client. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("add a policy the client already has: bound, no new-sale tasks, renewal review only", async ({ page, context }) => {
  const owner = await createTestUser("e2e-existing-policy");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");
  const effective = addMonths(addDays(today, 40), -12); // started ~11 months ago, renews in 40 days

  const { data: contact } = await api.from("contacts").insert({ contact_type: "individual", first_name: "Jordan", last_name: "Example" }).select("id").single();

  await page.goto(`/contacts/${contact!.id}`);
  await page.getByRole("link", { name: "Add existing policy" }).click();
  await expect(page.getByRole("heading", { name: "Add existing policy" })).toBeVisible();

  // Nothing entered: asks for a date.
  await page.getByRole("button", { name: "Add policy" }).click();
  await expect(page.getByText("Enter the effective date or the renewal date.")).toBeVisible();

  await page.getByLabel("Home", { exact: true }).check();
  await page.getByLabel("Carrier").fill("Example Mutual");
  await page.getByLabel("Annual premium").fill("1,450");
  await page.getByLabel("Effective date").fill(effective);
  await page.getByRole("button", { name: "Add policy" }).click();

  await expect(page.getByText("Policy added. The contact is a client; only the renewal review was scheduled.")).toBeVisible();
  await expect(page.getByText("A policy the client already had")).toBeVisible();

  const { data: opp } = await api.from("opportunities").select("id, outcome, existing_policy, effective_date, renewal_date").eq("contact_id", contact!.id).single();
  expect(opp).toMatchObject({ outcome: "won", existing_policy: true, effective_date: effective, renewal_date: addMonths(effective, 12) });
  const { data: tasks } = await api.from("tasks").select("category").eq("contact_id", contact!.id);
  expect(tasks!.map((t) => t.category)).toEqual(["renewal"]);
  const { data: c } = await api.from("contacts").select("relationship_status").eq("id", contact!.id).single();
  expect(c!.relationship_status).toBe("client");
});
