import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionCookies } from "../support/supabase";

// Phase 10: installable web app (manifest, icons, iPhone home-screen tags) and a service
// worker that keeps only static files and shows an offline notice — never pages or data.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("manifest, icons and home-screen tags; files load without signing in", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const m = await manifest.json();
  expect(m).toEqual(expect.objectContaining({ name: "Producr CRM", short_name: "Producr", start_url: "/dashboard", display: "standalone" }));
  for (const icon of [...m.icons, { src: "/icons/apple-touch-icon.png" }]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
  for (const path of ["/sw.js", "/offline.html"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }

  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Producr");
});

test("the service worker keeps only static files and shows the offline notice", async ({ page, context }) => {
  const owner = await createTestUser("e2e-pwa");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));

  await page.goto("/dashboard");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A reload puts the page under the worker's control; then visit a few more pages.
  await page.reload();
  for (const path of ["/contacts", "/tasks", "/reports", "/dashboard"]) await page.goto(path);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return { names: await caches.keys(), urls };
  });
  expect(cached.names).toEqual(["bass-crm-static-v3"]); // v3: new-lead alerts (Phase 26)
  expect(cached.urls).toContain("/offline.html");
  const notStatic = cached.urls.filter((u) => !(u.startsWith("/_next/static/") || u.startsWith("/icons/") || u === "/offline.html"));
  expect(notStatic).toEqual([]);

  await context.setOffline(true);
  await page.goto("/contacts").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByText("Nothing about your clients is stored on this phone.")).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
