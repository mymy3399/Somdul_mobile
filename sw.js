const CACHE_NAME = "somdul-shell-v3";
const SHELL_ASSETS = [
    "/",
    "/api.js",
    "/app.js",
    "/manifest.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin GET requests; let everything else (CDN
    // assets, cross-origin, non-GET) pass through untouched.
    if (request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }

    // Never cache the API — financial data must always be fresh; a stale
    // cached balance would be actively misleading, not just inconvenient.
    if (url.pathname.startsWith("/api/")) {
        return;
    }

    // App shell: network-first so edits/deploys show up immediately on the
    // next load, falling back to the cache only when offline.
    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
});
