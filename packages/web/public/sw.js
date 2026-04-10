const CACHE_NAME = "crew-v2";

// Install — skip waiting to activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate — clean ALL old caches, take control immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first for everything
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // API calls — network only (no caching)
  if (request.url.includes("/v2/") || request.url.includes("/a/")) return;

  // Everything else — network first, cache fallback (for offline)
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});
