import { expect, test, type Page } from "@playwright/test";
import { keyPages, seededOwner } from "./support/seed";

// Phase 10 responsive audit: every key page at 375 / 390 / 430 px wide (iPhone SE, 13–15,
// Pro Max) — no sideways scrolling, and every tap target at least 44 × 44 px. Links inside
// a sentence are exempt (WCAG 2.5.8 inline exception). All problems are listed at once.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const WIDTHS = [375, 390, 430];

function audit(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) {
      problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide)`);
    }
    const targets: Element[] = [
      ...document.querySelectorAll("a[href], button, select, textarea, summary, input:not([type=hidden]):not([type=checkbox]):not([type=radio])"),
    ];
    for (const box of document.querySelectorAll("input[type=checkbox], input[type=radio]")) targets.push(box.closest("label") ?? box);
    for (const el of new Set(targets)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden") continue; // not shown
      if (el.tagName === "A" && el.parentElement?.tagName === "P") continue; // link inside a sentence
      if (r.height < 43.5 || r.width < 43.5) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        problems.push(`${el.tagName.toLowerCase()} "${name}" is ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return problems;
  });
}

test("key pages fit 375/390/430 px screens with 44 px tap targets", async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = await seededOwner("e2e-responsive", APP_URL);
  const problems: string[] = [];

  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.addCookies(owner.cookies);
    const page = await context.newPage();
    for (const path of keyPages(owner)) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} loads`).toBe(200);
      for (const p of await audit(page)) problems.push(`${width}px ${path}: ${p}`);
    }
    // Signed-out pages too.
    await context.clearCookies();
    for (const path of ["/login", "/forgot-password", "/offline.html"]) {
      await page.goto(path);
      for (const p of await audit(page)) problems.push(`${width}px ${path}: ${p}`);
    }
    await context.close();
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
