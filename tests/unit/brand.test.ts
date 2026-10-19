import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTheme, themeClass, THEMES } from "@/lib/theme";

// Phase 22 (ADR-038): the Producr colours in src/app/globals.css. Light values must match the
// brand sheet; every text/background pairing the app uses must reach WCAG AA (4.5:1 for text,
// 3:1 for the focus ring and selected outlines) in both themes.
const CSS = readFileSync("src/app/globals.css", "utf8");

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const light = block(":root");
const darkClass = block(":root.dark");
const darkMedia = block(":root:not(.light)");
const dark = { ...light, ...darkClass };

function resolve(vars: Record<string, string>, name: string): string {
  let v = vars[name];
  for (let i = 0; v?.startsWith("var("); i++) {
    if (i > 5) throw new Error(`loop at ${name}`);
    v = vars[v.slice(4, -1).trim()];
  }
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a colour: ${v}`);
  return v;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

// [text, background, minimum] as used by the utilities in globals.css.
const PAIRS: [string, string, number][] = [
  ["--color-text-primary", "--ui-canvas", 4.5], ["--color-text-primary", "--color-surface", 4.5], ["--color-text-primary", "--ui-subtle", 4.5],
  ["--color-text-secondary", "--ui-canvas", 4.5], ["--color-text-secondary", "--color-surface", 4.5], ["--color-text-secondary", "--ui-subtle", 4.5],
  ["--color-text-secondary", "--color-brand-primary-soft", 4.5],
  ["--color-brand-ink", "--color-brand-primary", 4.5], ["--color-brand-ink", "--color-brand-primary-hover", 4.5],
  ["--color-text-primary", "--color-brand-primary-soft", 4.5],
  ["--ui-link", "--color-surface", 4.5], ["--ui-link", "--ui-canvas", 4.5], ["--ui-link", "--color-brand-primary-soft", 4.5],
  ["--color-success", "--ui-success-soft", 4.5], ["--color-success", "--color-surface", 4.5],
  ["--color-warning", "--ui-warning-soft", 4.5], ["--color-warning", "--color-surface", 4.5],
  ["--color-danger", "--ui-danger-soft", 4.5], ["--color-danger", "--color-surface", 4.5],
  // Archive button: card-coloured text on the warning colour.
  ["--color-surface", "--color-warning", 4.5],
  ["--ui-shell-text", "--ui-shell", 4.5], ["--ui-shell-muted", "--ui-shell", 4.5],
  ["--color-brand-primary", "--ui-shell", 3], ["--ui-link", "--ui-canvas", 3],
];

describe("Producr colours (Phase 22)", () => {
  it("light theme uses the brand sheet values", () => {
    expect(light).toMatchObject({
      "--color-brand-primary": "#55a7ff", "--color-brand-primary-hover": "#3694f5", "--color-brand-primary-soft": "#eaf4ff",
      "--color-brand-ink": "#111923", "--color-brand-cloud": "#f4f6f8", "--color-brand-slate": "#64748b",
      "--color-surface": "#ffffff", "--color-border": "#e2e8f0", "--color-text-primary": "#111923",
      "--color-success": "#15803d", "--color-warning": "#b45309", "--color-danger": "#b91c1c",
    });
    // The one deliberate change: secondary text is deeper than brand Slate, which fails on Cloud White.
    expect(contrast(light["--color-brand-slate"]!, light["--color-brand-cloud"]!)).toBeLessThan(4.5);
  });

  it("the dark theme is the same whether chosen in Settings or followed from the device", () => {
    expect(darkMedia).toEqual(darkClass);
  });

  for (const [name, vars] of [["light", light], ["dark", dark]] as const) {
    it(`${name}: every text and background pairing is readable`, () => {
      const failures = PAIRS.map(([fg, bg, min]) => [fg, bg, min, contrast(resolve(vars, fg), resolve(vars, bg))] as const)
        .filter(([, , min, ratio]) => ratio < min)
        .map(([fg, bg, min, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
      expect(failures).toEqual([]);
    });
  }

  it("white text on Electric Blue would fail, which is why buttons use Ink text", () => {
    expect(contrast("#ffffff", light["--color-brand-primary"]!)).toBeLessThan(4.5);
  });
});

describe("theme choice (Phase 22)", () => {
  it("accepts the three choices and falls back to following the device", () => {
    for (const t of THEMES) expect(parseTheme(t)).toBe(t);
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("blue")).toBe("system");
  });
  it("sets a class on the page only for an explicit choice", () => {
    expect(themeClass("system")).toBeUndefined();
    expect(themeClass("light")).toBe("light");
    expect(themeClass("dark")).toBe("dark");
  });
});

describe("components use the brand utilities (Phase 22)", () => {
  // Allowed: the last-resort error page (the stylesheet may not load), the browser bar colour
  // (a meta tag needs a literal), the quote-link QR code (black on white so phones can scan it),
  // and translucent white overlays on the Midnight Ink shell.
  const ALLOWED = new Set(["src/app/global-error.tsx", "src/app/layout.tsx", "src/components/intake/link-panel.tsx"]);
  it("no raw Tailwind palette colours or hex values in app code", () => {
    const files = execSync("git ls-files src/app src/components", { encoding: "utf8" }).split("\n")
      .filter((f) => /\.(tsx|ts)$/.test(f) && !ALLOWED.has(f));
    const PALETTE = /\b(?:bg|text|border|divide|outline|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?!\/)\b/;
    const offenders = files.flatMap((f) => readFileSync(f, "utf8").split("\n")
      .map((line, i) => ({ f, i, line }))
      .filter(({ line }) => PALETTE.test(line) || /#[0-9a-fA-F]{6}\b/.test(line)))
      .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    expect(offenders).toEqual([]);
  });
});
