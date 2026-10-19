// Draws the Producr P icons in public/icons (Phase 22). Run: node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
const P = (scale) => {
  // P drawn in a 32-unit box (same path as the in-app mark), scaled about the centre.
  const t = 16 - 16 * scale;
  return `<g transform="translate(${t} ${t}) scale(${scale})"><path d="M10.5 24V8.5h6.25a5.25 5.25 0 0 1 0 10.5H10.5" fill="none" stroke="#111923" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
};
const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%"><rect width="32" height="32" fill="#55A7FF"/>${P(scale)}</svg>`;
const out = [["icon-192.png", 192, 1.15], ["icon-512.png", 512, 1.15], ["apple-touch-icon.png", 180, 1.15], ["icon-maskable-512.png", 512, 0.9]];
// PLAYWRIGHT_CHROMIUM: optional path to a Chromium binary when the bundled one is not installed.
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
for (const [name, size, scale] of out) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg(scale)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
  await page.close();
}
await browser.close();
