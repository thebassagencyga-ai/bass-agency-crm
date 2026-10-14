import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;

// Enables Cloudflare bindings in `next dev` (ADR-004). No-op outside development.
if (process.env.NODE_ENV === "development") {
  void import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
