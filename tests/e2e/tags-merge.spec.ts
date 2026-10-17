import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 17: tags (add, filter, rename in Settings) and merging a duplicate contact on a
// phone-sized screen. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const noSidewaysScroll = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("tag contacts, filter by tag, merge a duplicate, rename a tag", async ({ page, context }) => {
  const owner = await createTestUser("e2e-tags");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const insert = async (values: Record<string, unknown>) => (await api.from("contacts").insert(values).select("id").single()).data!.id as string;
  const robin = await insert({ contact_type: "individual", first_name: "Robin", last_name: "Example", phone: "404-555-0101" });
  const dup = await insert({ contact_type: "individual", first_name: "Rob", last_name: "Example", phone: "(404) 555-0101", email: "robin@example.com", tags: ["Church"] });
  await insert({ contact_type: "individual", first_name: "Other", last_name: "Example" });
  const { data: stage } = await api.from("pipeline_stages").select("id").eq("product_line", "auto").eq("code", "new_lead").single();
  await api.from("opportunities").insert({ contact_id: dup, product_line: "auto", stage_id: stage!.id });

  // Tag Robin; a tag typed in another case joins the existing one.
  await page.goto(`/contacts/${robin}/edit`);
  await page.getByLabel("Tags", { exact: false }).fill("VIP, church");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();
  const tags = page.getByRole("list", { name: "Tags" });
  await expect(tags).toHaveText(/VIP\s*Church/);

  // Filter the list by tag.
  await tags.getByRole("link", { name: "VIP" }).click();
  await expect(page).toHaveURL(/\/contacts\?tag=VIP$/);
  const list = page.getByRole("list", { name: "Contacts" });
  await expect(list).toContainText("Robin Example");
  await expect(list).not.toContainText("Rob Example");
  await expect(list).not.toContainText("Other Example");
  await page.goto("/contacts?tag=church");
  await expect(list).toContainText("Robin Example");
  await expect(list).toContainText("Rob Example");

  // The duplicate is pointed out on the contact page; compare, then merge.
  await page.goto(`/contacts/${robin}`);
  await page.getByRole("link", { name: "Compare and merge with Rob Example" }).click();
  await expect(page.getByRole("heading", { name: "Merge duplicates" })).toBeVisible();
  const preview = page.getByRole("definition").filter({ hasText: "robin@example.com" });
  await expect(preview).toContainText("from the duplicate");
  await expect(page.getByText("Moves to Robin Example: 1 opportunity", { exact: false })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Merge into Robin Example" }).click();
  await expect(page.getByText("Contacts merged.", { exact: false })).toBeVisible();
  await expect(page.getByRole("list", { name: "Opportunities for this contact" })).toContainText("Auto");
  await expect(page.getByText("robin@example.com")).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toHaveCount(0);

  // The duplicate is kept, archived, pointing at Robin.
  await page.goto(`/contacts/${dup}`);
  await expect(page.getByText("This contact was merged into", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("link", { name: "Robin Example" }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${robin}$`));

  // Rename the tag everywhere from Settings.
  await page.goto("/settings#tags");
  const tagList = page.getByRole("list", { name: "Tags in use" });
  await tagList.getByText("Church").click();
  await page.locator("#tags").getByLabel("New name").first().fill("First Baptist");
  await page.locator("#tags").getByRole("button", { name: "Rename" }).first().click();
  await expect(page.getByText("Tag renamed on every contact.")).toBeVisible();
  await page.goto(`/contacts/${robin}`);
  await expect(page.getByRole("list", { name: "Tags" })).toHaveText(/VIP\s*First Baptist/);
  expect(await noSidewaysScroll(page)).toBe(true);
});
