// Security headers (SECURITY.md). The CSP uses a fresh nonce per request, set in
// src/middleware.ts; Next.js applies it to its own scripts.

export function buildContentSecurityPolicy(nonce: string, { development }: { development: boolean }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Next.js and React inject inline styles; style injection cannot run script.
    "style-src 'self' 'unsafe-inline'",
    // data: is needed for the authenticator QR code image.
    "img-src 'self' data:",
    "font-src 'self'",
    // The service worker (public/sw.js) and the web app manifest come from this app only.
    // worker-src is explicit because 'strict-dynamic' makes script-src ignore 'self'.
    "worker-src 'self'",
    "manifest-src 'self'",
    // The browser only talks to this app; it never calls Supabase directly.
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};
