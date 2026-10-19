// Settings → Alerts (Phase 26): what the browser sends when alerts are turned on, checked on the
// server, and a plain name for the device so the agent can tell their devices apart.
import { z } from "zod";
import { isAcceptableEndpoint } from "./webpush";

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isAcceptableEndpoint, "This browser's push address is not supported."),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});

export type BrowserSubscription = z.infer<typeof subscriptionSchema>;

/** "iPhone", "iPad", "Mac (Chrome)", "Windows (Edge)", "Android (Chrome)"; never more detail. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const device = ua.includes("iphone") ? "iPhone" : ua.includes("ipad") ? "iPad" : ua.includes("android") ? "Android"
    : ua.includes("mac os") ? "Mac" : ua.includes("windows") ? "Windows" : ua.includes("linux") ? "Linux" : "This device";
  if (device === "iPhone" || device === "iPad") return device;
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox/") ? "Firefox" : ua.includes("chrome/") ? "Chrome"
    : ua.includes("safari/") ? "Safari" : null;
  return browser ? `${device} (${browser})` : device;
}
