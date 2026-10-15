import { chromium, expect, test } from "@playwright/test";
import { keyPages, seededOwner } from "./support/seed";

// Phase 10: Lighthouse accessibility score ≥ 90 on every key page, signed in, using the same
// Chromium as the browser tests and Lighthouse's default phone emulation. Lighthouse runs
// locally (no external service). Failing audits are listed when a page scores below 90.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";
const MIN_SCORE = 0.9;

type Audit = { id: string; title: string; score: number | null; scoreDisplayMode: string };

test("Lighthouse accessibility ≥ 90 on key pages", async () => {
  test.setTimeout(600_000);
  const owner = await seededOwner("e2e-lighthouse", APP_URL);
  const cookie = owner.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const { default: lighthouse } = await import("lighthouse");
  const { launch } = await import("chrome-launcher");
  const chrome = await launch({
    chromePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  const results: string[] = [];
  const failures: string[] = [];
  try {
    for (const path of ["/login", ...keyPages(owner)]) {
      const run = await lighthouse(`${APP_URL}${path}`, {
        port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["accessibility"],
        extraHeaders: path === "/login" ? {} : { Cookie: cookie },
      });
      const category = run?.lhr.categories.accessibility;
      const score = category?.score ?? 0;
      const failing = Object.values((run?.lhr.audits ?? {}) as Record<string, Audit>)
        .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary")
        .map((a) => `${a.id} (${a.title})`);
      results.push(`${path}: ${Math.round(score * 100)}${failing.length ? ` — ${failing.join("; ")}` : ""}`);
      if (run?.lhr.finalDisplayedUrl && !run.lhr.finalDisplayedUrl.startsWith(`${APP_URL}${path.split("?")[0]}`)) {
        failures.push(`${path}: ended at ${run.lhr.finalDisplayedUrl} (not signed in?)`);
      }
      if (score < MIN_SCORE) failures.push(`${path}: ${Math.round(score * 100)} — ${failing.join("; ")}`);
    }
  } finally {
    chrome.kill();
  }
  console.log(`Lighthouse accessibility:\n${results.join("\n")}`);
  expect(failures, failures.join("\n")).toEqual([]);
});
