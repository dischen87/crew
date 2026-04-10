// Build version injected by Vite at build time — ensures every deploy
// produces a byte-different SW file so the browser detects the update.
const BUILD_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = "crew-" + BUILD_VERSION;

// Install — skip waiting so the new SW activates immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate — purge ALL old caches, claim all clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all clients that a new version is active
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: "SW_UPDATED", version: BUILD_VERSION })
          );
        });
      })
  );
});

// Message handler — allows the app to force skipWaiting
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch — network-first for pages/assets, network-only for API
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET
  if (request.method !== "GET") return;

  // Golf data — network-first with cache fallback for offline scorecard
  if (
    request.url.includes("/v2/golf/round/") ||
    request.url.includes("/v2/golf/course/") ||
    request.url.includes("/v2/golf/handicap/") ||
    request.url.includes("/v2/golf/event/")
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || new Response('{"error":"offline"}', {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }))
        )
    );
    return;
  }

  // Other API calls — always network, never cache
  if (request.url.includes("/v2/") || request.url.includes("/a/")) return;

  // Navigation requests (HTML pages) — always network, no cache
  // This ensures the latest index.html is always served
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((cached) => cached || fetch(request))
      )
    );
    return;
  }

  // Static assets — network-first, cache fallback for offline
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
  );
});

// Background Sync — flush pending scores when connectivity is restored.
// The SW cannot access localStorage (auth token), so it delegates to the
// active client via postMessage.
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-scores") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        if (clients.length > 0) {
          clients[0].postMessage({ type: "SYNC_SCORES" });
        }
      })
    );
  }
});
