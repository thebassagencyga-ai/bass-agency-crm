"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (static assets and the offline page only; see ADR-025).
 * Production builds only, so development never serves stale assets.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the app works without it (no offline notice).
    });
  }, []);
  return null;
}
