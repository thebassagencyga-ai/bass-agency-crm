import { defineConfig, devices } from "@playwright/test";

// Browser journey tests (CI, against the Cloudflare build and a local Supabase stack).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  projects: [{ name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" } }],
});
