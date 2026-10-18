import { expect, test, type Page } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 21: phone bottom bar with "More", search from any page, and the pinned Call · Text · Log
// bar on a contact. Runs on the iPhone 13 project. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

/** True when the end of the page can be scrolled clear of the fixed bottom bar. */
async function endOfPageClearsBottomBar(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const main = document.getElementById("main")!;
    const last = main.lastElementChild!.getBoundingClientRect();
    const bar = document.querySelector("nav[aria-label=Main].fixed")!.getBoundingClientRect();
    return last.bottom <= bar.top;
  });
}

test("phone: bottom bar, More menu, search anywhere, contact quick actions", async ({ page, context }) => {
  const owner = await createTestUser("e2e-phone-polish");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const { data: robin } = await api.from("contacts")
    .insert({ contact_type: "individual", first_name: "Robin", last_name: "Example", phone: "(404) 555-0101", email: "robin@example.com" })
    .select("id").single();
  await api.from("contacts").insert({ contact_type: "individual", first_name: "Casey", last_name: "Sample" });

  // Bottom bar: the four daily pages plus More; the sidebar list is not shown on a phone.
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toHaveCount(1);
  for (const name of ["Today", "Contacts", "Tasks", "Renewals"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);

  const more = nav.getByRole("button", { name: "More" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Intake", "Opportunities", "Reports", "Settings"]) await expect(nav.getByRole("link", { name })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await more.click();
  await nav.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0); // closed after navigating
  await expect(more).toHaveAttribute("aria-current", "page");
  expect(await endOfPageClearsBottomBar(page)).toBe(true);

  // Search from any page goes to the filtered contacts list (which has its own search box).
  await page.goto("/tasks");
  await page.getByRole("searchbox", { name: "Find a contact" }).fill("Robin");
  await page.getByRole("searchbox", { name: "Find a contact" }).press("Enter");
  await expect(page).toHaveURL(/\/contacts\?q=Robin$/);
  const list = page.getByRole("list", { name: "Contacts" });
  await expect(list).toContainText("Robin Example");
  await expect(list).not.toContainText("Casey Sample");
  await expect(page.getByRole("searchbox", { name: "Find a contact" })).toHaveCount(0);

  // Contact page: Call · Text · Log stay pinned while scrolling; Text and Log open their sections.
  await page.addInitScript(() => {
    document.addEventListener("click", (e) => {
      if ((e.target as Element | null)?.closest?.('a[href^="tel:"]')) e.preventDefault();
    }, true);
  });
  await page.goto(`/contacts/${robin!.id}`);
  const bar = page.getByRole("navigation", { name: "Quick actions" });
  await expect(bar.getByRole("link", { name: "Call Robin Example" })).toHaveAttribute("href", "tel:+14045550101");

  await bar.getByRole("link", { name: "Text or email Robin Example" }).click();
  await expect(page.locator("details#message")).toHaveAttribute("open", "");
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  expect((await bar.boundingBox())!.y).toBeLessThanOrEqual(1); // pinned to the top

  await bar.getByRole("link", { name: "Log a call or visit with Robin Example" }).click();
  await expect(page.locator("details#log-activity")).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Log activity", exact: true })).toBeInViewport();
  expect(await endOfPageClearsBottomBar(page)).toBe(true);

  // Arriving with the section in the address opens it as well (a fresh page load, not a jump).
  await page.goto("/dashboard");
  await page.goto(`/contacts/${robin!.id}#log-activity`);
  await expect(page.locator("details#log-activity")).toHaveAttribute("open", "");
});
