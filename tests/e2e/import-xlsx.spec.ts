import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";
import { makeXlsx } from "../support/xlsx-fixture";

// Import fix (after the owner uploaded an .xlsx and saw zip bytes): an Excel report is read on
// the device and imported like a CSV; an old .xls or a non-report file gets a clear message.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("import an Excel (.xlsx) report; old .xls and other files are refused clearly", async ({ page, context }) => {
  test.setTimeout(120_000);
  const owner = await createTestUser("e2e-import-xlsx");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import clients" })).toBeVisible();

  // An old Excel file (OLE header) → ask for .xlsx or CSV, nothing else shown.
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  await page.locator("#import-file").setInputFiles({ name: "report.xls", mimeType: "application/vnd.ms-excel", buffer: ole });
  await expect(page.locator("p[role=alert]")).toContainText("This is an old Excel file (.xls)");
  await expect(page.getByText("2. Match the columns")).toHaveCount(0);

  const xlsx = makeXlsx([
    ["Insured Name", "Policy Type", "Annual Premium", "Exp Date", "Phone Number"],
    ["Example, Robin", "Personal Auto", 1200, { date: inDays(30) }, "(404) 555-0101"],
    ["Sam Example", "HO3", 850.5, { date: inDays(60) }, null],
    ["Example Bakery LLC", "BOP", 3000, null, "404-555-0102"],
  ]);
  await page.locator("#import-file").setInputFiles({ name: "clients.xlsx", mimeType: XLSX, buffer: Buffer.from(xlsx) });
  await expect(page.getByText("clients.xlsx: 3 rows, 5 columns.")).toBeVisible();
  await expect(page.locator("p[role=alert]")).toHaveCount(0);
  await expect(page.locator("#map-full_name")).toHaveValue("0");
  await expect(page.locator("#map-renewal_date")).toHaveValue("3");

  await page.getByRole("button", { name: "Check the file" }).click();
  const summary = page.getByRole("list", { name: "Import summary" });
  await expect(summary).toContainText("3Clients");
  await expect(summary).toContainText("3Policies");
  await page.getByRole("button", { name: "Import 3 clients" }).click();
  await expect(page.getByText("Imported clients.xlsx: 3 new contacts")).toBeVisible({ timeout: 30_000 });

  // The Excel date came through as a real renewal date.
  await page.goto("/renewals?days=60");
  await expect(page.getByRole("list", { name: "Client policies" })).toContainText("Robin Example · Auto");
});
