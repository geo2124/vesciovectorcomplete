// Vescio Vector Service Worker - Network-First PWA caching & offline capability
const CACHE_NAME = "vescio-vector-v4-network-first";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.png",
  "/vescio-vector-logo.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => {
        console.warn("PWA pre-cache warning:", err);
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept Firestore, Firebase, Google Auth, Vite dev modules, dynamic route split chunks, or backend API endpoints
  if (
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("apis.google.com") ||
    url.hostname.includes("googleapis.com") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/node_modules/") ||
    url.pathname.startsWith("/@") ||
    url.search.includes("tsr-split") ||
    url.search.includes("v=") ||
    url.search.includes("t=")
  ) {
    return;
  }

  // HTML navigation requests & JS/CSS bundles: Strictly Network-First with offline cache fallback
  const isCodeOrNavigation = req.mode === "navigate" || url.pathname.match(/\.(js|mjs|css|html)$/i);

  if (isCodeOrNavigation) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(req, clone))
              .catch(() => {});
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === "navigate") {
              return caches.match("/");
            }
            return Response.error();
          }),
        ),
    );
    return;
  }

  // Static media/font/icon assets: Network-First with Cache Fallback
  const isStaticMedia =
    url.pathname.match(/\.(woff2?|ttf|eot|svg|png|jpg|jpeg|webp|ico|webmanifest)$/i) ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com");

  if (isStaticMedia) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(req, clone))
              .catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match(req)),
    );
  }
});
