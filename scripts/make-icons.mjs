// Draws the Producr P icons in public/icons (Phase 22). Run: node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
// "P." in Inter Bold, as in src/components/brand.tsx (MARK_PATH / MARK_TRANSFORM).
const MARK = `<path transform="translate(8.241 22.25) scale(0.008389 -0.008389)" fill="#111923" d="M135 0V1490H716Q886 1490 1005 1425Q1124 1361 1186 1247Q1249 1134 1249 987Q1249 839 1185 727Q1122 614 1001 550Q881 487 709 487H335V733H660Q754 733 814 765Q875 798 904 855Q934 912 934 987Q934 1062 904 1119Q875 1176 814 1207Q753 1238 659 1238H440V0ZM1542 -19Q1469 -19 1419 31Q1369 80 1369 153Q1369 226 1419 275Q1469 324 1542 324Q1615 324 1665 275Q1715 226 1715 153Q1715 80 1665 31Q1615 -19 1542 -19Z"/>`;
const P = (scale) => {
  // The mark sits in a 32-unit box; scale it about the centre.
  const t = 16 - 16 * scale;
  return `<g transform="translate(${t} ${t}) scale(${scale})">${MARK}</g>`;
};
const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%"><rect width="32" height="32" fill="#55A7FF"/>${P(scale)}</svg>`;
const out = [["icon-192.png", 192, 1.3], ["icon-512.png", 512, 1.3], ["apple-touch-icon.png", 180, 1.3], ["icon-maskable-512.png", 512, 1.0]];
// PLAYWRIGHT_CHROMIUM: optional path to a Chromium binary when the bundled one is not installed.
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
for (const [name, size, scale] of out) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg(scale)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
  await page.close();
}
await browser.close();
