// Service worker for Producr CRM (Phase 10, ADR-025).
//
// It caches ONLY static files: the app's hashed build assets (/_next/static/), its icons and
// the offline notice page. Pages, server actions, data requests and anything else always go
// to the network and are never stored, so no client record is ever kept on the device.
// When a page cannot load because the device is offline, the offline notice is shown.

const VERSION = "v2"; // v2: Producr name, icons and colours (Phase 22)
const CACHE_PREFIX = "bass-crm-static-";
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

/** True only for static, non-personal files that are safe to keep on the device. */
function isCacheableStatic(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // React Server Component and prefetch requests carry page data: never cache them.
  if (request.headers.has("RSC") || request.headers.has("Next-Router-Prefetch") || url.searchParams.has("_rsc")) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  return url.search === "" && (url.pathname === OFFLINE_URL || url.pathname.startsWith("/icons/"));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Pages: always from the network; never stored. Offline → the notice page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!isCacheableStatic(request)) return; // everything else: the browser's normal handling

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    }),
  );
});
