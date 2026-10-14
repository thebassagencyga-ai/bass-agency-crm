import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cloudflare Workers adapter config (ADR-004). No incremental cache is configured:
// CRM pages are dynamic and per-user, and must not be cached.
export default defineCloudflareConfig();
