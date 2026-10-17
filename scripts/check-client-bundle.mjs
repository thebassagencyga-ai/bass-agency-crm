#!/usr/bin/env node
// Fails if anything secret, or any Supabase configuration, reached code sent to browsers
// (SECURITY.md §5). Scans the built client assets in .next/static (and .open-next/assets
// when present). Extra literal values to forbid can be passed in FORBIDDEN_VALUES
// (comma-separated), e.g. the local stack's keys in CI.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const roots = [".next/static", ".open-next/assets"].filter((d) => existsSync(d));
if (roots.length === 0) {
  console.error("✗ No build output found. Run `npm run build` first.");
  process.exit(1);
}

const patterns = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, "Supabase secret key"],
  [/sk-ant-[A-Za-z0-9_-]{8,}/, "Anthropic API key"],
  [/ANTHROPIC_API_KEY|api\.anthropic\.com/, "Anthropic key name or API address (AI calls are server-only)"],
  [/service_role/, "service_role reference"],
  [/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE/, "secret key variable name"],
  [/SUPABASE_PUBLISHABLE_KEY|SUPABASE_URL/, "Supabase config variable name (browser must not talk to Supabase)"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];
const values = (process.env.FORBIDDEN_VALUES ?? "").split(",").map((v) => v.trim()).filter((v) => v.length >= 8);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|css|html|json|txt|map)$/.test(name)) yield full;
  }
}

let scanned = 0;
const problems = [];
for (const root of roots) {
  for (const file of files(root)) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    for (const [re, label] of patterns) if (re.test(text)) problems.push(`${file}: ${label}`);
    for (const v of values) if (text.includes(v)) problems.push(`${file}: a forbidden value (${v.slice(0, 4)}…)`);
  }
}
if (problems.length > 0) {
  console.error(`✗ Browser bundle check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ Browser bundle clean: ${scanned} files scanned in ${roots.join(", ")}${values.length ? `, ${values.length} forbidden values checked` : ""}.`);
