#!/usr/bin/env node
// Secret scan of the repository: every tracked file AND every line ever added in Git history
// (SECURITY.md; Phase 11). Fails on credentials, private keys, connection strings with a
// password, tracked .env files, and data that must never be stored here (SSN-like numbers).
// Runs in CI on every push (full history) and locally: node scripts/secret-scan.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SELF = new Set(["scripts/secret-scan.mjs", "scripts/check-client-bundle.mjs"]);

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bsb_secret_[A-Za-z0-9_-]{16,}/, "Supabase secret key"],
  [/\bsbp_[a-f0-9]{40}\b/, "Supabase access token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JSON Web Token (e.g. a Supabase key)"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "Slack token"],
  // Throwaway CI/local test databases (localhost) are allowed; any other host is not.
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{3,}@(?!localhost[:/]|127\.0\.0\.1[:/])/, "database URL with a password"],
  [/\b(?:CLOUDFLARE_API_TOKEN|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SUPABASE_SECRET_KEY)\s*[=:]\s*["']?(?!replace-with)[A-Za-z0-9_\-]{20,}/, "secret assigned a literal value"],
  [/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/, "SSN-like number (never store SSNs)"],
];
const ALLOWED_ENV = /(^|\/)\.env\.example$/;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const problems = [];
const check = (where, line) => {
  for (const [re, label] of PATTERNS) if (re.test(line)) problems.push(`${where}: ${label}`);
};

// 1. Tracked files as they are on disk now (so staged changes are checked before a commit).
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
for (const file of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !ALLOWED_ENV.test(file)) problems.push(`${file}: .env file is tracked`);
  if (SELF.has(file) || /\.(png|jpg|ico|woff2?)$/.test(file) || file === "package-lock.json" || !existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => check(`${file}:${i + 1}`, line));
}

// 2. Every added line in history (all branches), so a secret committed and later removed is found.
let commit = "";
let file = "";
for (const line of git("log", "--all", "-p", "--no-color", "--unified=0", "--format=commit %H").split("\n")) {
  if (line.startsWith("commit ")) commit = line.slice(7, 15);
  else if (line.startsWith("+++ b/")) file = line.slice(6);
  else if (line.startsWith("+") && !line.startsWith("+++") && !SELF.has(file) && file !== "package-lock.json") {
    check(`history ${commit} ${file}`, line.slice(1));
  }
}
for (const name of git("log", "--all", "--name-only", "--format=").split("\n")) {
  if (/(^|\/)\.env(\.|$)/.test(name) && !ALLOWED_ENV.test(name)) problems.push(`history: ${name} was committed`);
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`✗ Secret scan found ${unique.length} problem(s):\n${unique.join("\n")}`);
  process.exit(1);
}
console.log(`✓ Secret scan: ${tracked.length} tracked files and full history (${git("rev-list", "--all", "--count").trim()} commits) clean.`);
