// Renders the app icons (PNG) from one SVG design with the Playwright Chromium already used
// for tests. Run once when the design changes: node scripts/generate-icons.mts
// Output is committed in public/icons/. No network, no third-party service.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const NAVY = "#0f172a";

/** Square icon; `glyph` is the letter's share of the canvas (smaller for maskable safe zone). */
const svg = (size: number, glyph: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${NAVY}"/>
  <text x="50" y="50" dy="0.35em" font-family="Arial, Helvetica, 'Liberation Sans', sans-serif"
        font-size="${glyph * 100}" font-weight="700" fill="#ffffff" text-anchor="middle">B</text>
</svg>`;

const ICONS = [
  { file: "apple-touch-icon.png", size: 180, glyph: 0.62 },
  { file: "icon-192.png", size: 192, glyph: 0.62 },
  { file: "icon-512.png", size: 512, glyph: 0.62 },
  // Maskable: platforms may crop to a circle; keep the letter inside the central 80%.
  { file: "icon-maskable-512.png", size: 512, glyph: 0.46 },
];

await mkdir("public/icons", { recursive: true });
// CHROMIUM_PATH: use an already-installed Chromium when Playwright's own build is absent.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<html><body style="margin:0">${svg(icon.size, icon.glyph)}</body></html>`);
  await page.locator("svg").screenshot({ path: `public/icons/${icon.file}`, omitBackground: false });
  console.log(`public/icons/${icon.file} (${icon.size}×${icon.size})`);
}
await browser.close();
