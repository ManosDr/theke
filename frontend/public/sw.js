// Minimal app-shell cache so the login page and static assets are available
// offline / on a flaky connection. Network-first: always try the network,
// fall back to cache only when the request fails outright.
//
// v2: v1 intercepted and cached *every* same-origin GET indiscriminately,
// including Next.js's content-hashed /_next/static/chunks/*.js build assets
// and API calls. That's actively harmful for build assets specifically -
// Next already busts its own cache via the content hash in the filename, so
// caching those here just gives a second, SW-controlled place a stale chunk
// can be served from after a rebuild (dev recompile or a prod deploy),
// producing "ChunkLoadError: Loading chunk X failed" for dynamic
// (next/dynamic) imports whose chunk the SW served a stale copy of. Scope
// the cache to the app-shell URLs only; let the browser/network handle
// everything else, the way Next.js's own cache-busting expects.
const CACHE_NAME = "theke-shell-v2";
const SHELL_URLS = ["/", "/manifest.json", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (!SHELL_URLS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
