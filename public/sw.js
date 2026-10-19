// Service worker for Producr CRM (Phase 10, ADR-025).
//
// It caches ONLY static files: the app's hashed build assets (/_next/static/), its icons and
// the offline notice page. Pages, server actions, data requests and anything else always go
// to the network and are never stored, so no client record is ever kept on the device.
// When a page cannot load because the device is offline, the offline notice is shown.

const VERSION = "v3"; // v3: new-lead alerts (Phase 26)
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

// New-lead alerts (Phase 26, ADR-044). The message carries no customer details: a title, a line
// of text and the page to open. Every push shows a notification (required on iPhone).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "Producr CRM";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: "new-lead", data: { url } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.navigate(target).then((c) => (c ? c.focus() : self.clients.openWindow(target)));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

