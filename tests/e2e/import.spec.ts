import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 15: import a 500-client report on a phone-sized screen (column matching, an unknown
// policy type, a match with an existing contact, a bad row), undo it, and download data.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

const inDays = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
};

function report(): string {
  const lines = ["Insured Name,Policy Type,Writing Company,Annual Premium,Eff Date,Exp Date,Phone Number,E-Mail,Zip Code"];
  lines.push(`"Example, Robin",Personal Auto,Example Mutual,"$1,200.00",${inDays(-150)},${inDays(30)},(404) 555-0101,,30117`);
  lines.push(`Example Bakery LLC,BOP,Sample Ins,3000,,,404-555-0102,,30117`);
  lines.push(`Sam Example,Pet,,,,,,sam@example.com,`);
  lines.push(`,Personal Auto,,,,,,,`);
  for (let i = 0; i < 497; i++) lines.push(`"Person${i}, Example",HO3,Example Mutual,${800 + i},,${inDays(40 + i)},,person${i}@example.com,30117`);
  return lines.join("\r\n");
}

test("import a 500-client report, undo it, download data", async ({ page, context }) => {
  test.setTimeout(240_000);
  const owner = await createTestUser("e2e-import");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const { data: robin } = await api.from("contacts")
    .insert({ contact_type: "individual", first_name: "Robin", last_name: "Example", phone: "404-555-0101", notes: "=HYPERLINK(\"http://example.com\")" })
    .select("id").single();

  await page.goto("/contacts");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import clients" })).toBeVisible();
  await page.locator("#import-file").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(report()) });
  await expect(page.getByText("clients.csv: 501 rows, 9 columns.")).toBeVisible();

  // Columns were guessed; the unknown "Pet" type must be decided before checking.
  await expect(page.locator("#map-full_name")).toHaveValue("0");
  await expect(page.locator("#map-renewal_date")).toHaveValue("5");
  await expect(page.getByRole("button", { name: "Check the file" })).toBeDisabled();
  await page.locator("#line-pet").selectOption("skip");
  await page.getByRole("button", { name: "Check the file" }).click();

  const summary = page.getByRole("list", { name: "Import summary" });
  await expect(summary).toContainText("500Clients");
  await expect(summary).toContainText("1Already in CRM");
  await expect(summary).toContainText("499Policies");
  await expect(summary).toContainText("1Rows left out");
  await expect(page.getByText("Row 2: add to Robin Example")).toBeVisible();
  await expect(page.getByRole("list", { name: "Import problems" })).toContainText("Row 5 (left out): No name.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Import 500 clients" }).click();
  await expect(page.getByText("Imported clients.csv: 499 new contacts, 1 existing contacts updated with policies, 499 policies.")).toBeVisible({ timeout: 60_000 });

  // The matched contact got its policy and is otherwise unchanged.
  await page.goto(`/contacts/${robin!.id}`);
  await expect(page.getByRole("list", { name: "Opportunities for this contact" })).toContainText("Auto");
  await expect(page.getByRole("list", { name: "Opportunities for this contact" })).toContainText("Won");
  // Imported policies show on Renewals.
  await page.goto("/renewals?days=60");
  await expect(page.getByRole("list", { name: "Client policies" })).toContainText("Robin Example · Auto");

  // Download contacts: a CSV with the name and the note made harmless for Excel.
  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("list", { name: "Downloads" }).getByRole("link", { name: "Contacts" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^producr-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.startsWith("﻿Name,Type,First name")).toBe(true);
  expect(csv).toContain("Example Bakery LLC");
  expect(csv).toContain(`"'=HYPERLINK(""http://example.com"")"`);
  expect(csv.split("\r\n").filter(Boolean)).toHaveLength(501); // heading + Robin + 499 imported

  // Undo removes the import, leaves Robin.
  await page.goto("/import");
  await page.getByRole("button", { name: "Undo import of clients.csv" }).click();
  await expect(page.getByText("Import undone")).toBeVisible({ timeout: 60_000 });
  const { count } = await api.from("contacts").select("id", { count: "exact", head: true });
  expect(count).toBe(1);
  const { data: robinOpps } = await api.from("opportunities").select("id").eq("contact_id", robin!.id);
  expect(robinOpps).toEqual([]);
});
