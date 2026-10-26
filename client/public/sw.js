/**
 * OpenRadlr service worker: makes the client installable and lets it open
 * without a network (the start screen then says the server is unreachable).
 *
 * Network first, so `make update` on the server reaches riders right away;
 * the cache is only a fallback. Live data is never cached: /api, /ws, /auth.
 */
const CACHE = "openradlr-shell-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/manifest.webmanifest", "/js/main.js", "/icons/icon-192.png", "/icons/brand-mark.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const isLive = (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/ws";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || isLive(url)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/index.html"))),
  );
});
