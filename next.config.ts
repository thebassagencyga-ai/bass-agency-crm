import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A 1,000-client import (Phase 15) is a few hundred KB of JSON; the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;

// Enables Cloudflare bindings in `next dev` (ADR-004). No-op outside development.
if (process.env.NODE_ENV === "development") {
  void import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
