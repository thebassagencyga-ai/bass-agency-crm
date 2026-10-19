import { expect, test } from "@playwright/test";
import { addDays, formatDateOnly, todayInZone } from "../../src/lib/dates";
import { createTestUser, fullSessionClient, fullSessionCookies, ownStage } from "../support/supabase";

// Phase 24 (ADR-040): Contacts opens on Leads; Clients is the book (lines, premium, next renewal,
// cross-sell gap); search from anywhere still finds everyone; open deals for clients are tagged on
// the pipeline. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("leads and clients tabs, book view, client tag on the pipeline", async ({ page, context }) => {
  const owner = await createTestUser("e2e-leads-clients");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const today = todayInZone("America/New_York");
  const stage = async (line: string, code: string) =>
    ownStage(api, line, code);
  const contact = async (first: string, status = "prospect") =>
    (await api.from("contacts").insert({ contact_type: "individual", first_name: first, last_name: "Example", relationship_status: status }).select("id").single()).data!.id as string;

  // A lead with a quoted auto deal (quote date and its follow-up are recorded automatically).
  const jordan = await contact("Jordan");
  await api.from("opportunities").insert({ contact_id: jordan, product_line: "auto", stage_id: await stage("auto", "quoted") });
  // A client: a bound home policy (becomes a client automatically), plus an open auto deal.
  const robin = await contact("Robin");
  const renews = addDays(today, 40);
  await api.from("opportunities").insert({
    contact_id: robin, product_line: "home", stage_id: await stage("home", "bound"), outcome: "won",
    estimated_annual_premium: 1200, renewal_date: renews,
  });
  await api.from("opportunities").insert({ contact_id: robin, product_line: "auto", stage_id: await stage("auto", "new_lead") });
  await contact("Casey", "former_client");

  // Contacts opens on Leads.
  await page.goto("/contacts");
  const tabs = page.getByRole("navigation", { name: "Contact groups" });
  await expect(tabs.getByRole("link", { name: /Leads/ })).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("list", { name: "Contacts" });
  await expect(list).toContainText("Jordan Example");
  await expect(list).not.toContainText("Robin Example");
  await expect(list).toContainText(`Auto · Quoted · quoted ${formatDateOnly(today)}`);
  await expect(list).toContainText("Next: Follow up on quote");

  // Clients: the book.
  await tabs.getByRole("link", { name: /Clients/ }).click();
  await expect(page).toHaveURL(/tab=clients/);
  await expect(list).toContainText("Robin Example");
  await expect(list).not.toContainText("Jordan Example");
  await expect(list).toContainText("Home · $1,200/yr");
  await expect(list).toContainText(`Next renewal ${formatDateOnly(renews)}`);
  await expect(list.getByText("No life")).toBeVisible();

  // Former and All.
  await tabs.getByRole("link", { name: /Former/ }).click();
  await expect(list).toContainText("Casey Example");
  await tabs.getByRole("link", { name: /All/ }).click();
  for (const name of ["Jordan Example", "Robin Example", "Casey Example"]) await expect(list).toContainText(name);

  // Search from the header finds a client even though Contacts opens on Leads.
  await page.goto("/tasks");
  await page.getByRole("searchbox", { name: "Find a contact" }).fill("Robin");
  await page.getByRole("searchbox", { name: "Find a contact" }).press("Enter");
  await expect(list).toContainText("Robin Example");

  // The pipeline tags the client's open auto deal, not the new lead's.
  await page.goto("/opportunities?line=auto");
  const card = (name: string) => page.locator("li[id^='opp-']").filter({ hasText: name });
  await expect(card("Robin Example").getByText("Client", { exact: true })).toBeVisible();
  await expect(card("Jordan Example").getByText("Client", { exact: true })).toHaveCount(0);
});
