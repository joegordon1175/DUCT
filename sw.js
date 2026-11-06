/* DUCT service worker — offline-first for a tool that gets used in plant rooms
   and risers where there is no signal.

   The cache is a *fallback only*, never a source of truth: every same-origin
   GET goes to the network with `cache: 'reload'`, which bypasses the browser's
   HTTP cache as well as this one. Without that, GitHub Pages' `max-age`
   headers let a stale response come back through `fetch()` and get re-stored
   here, so a release could stay invisible far longer than the header implies.

   BUMP CACHE_VERSION ON EVERY RELEASE. That is not belt-and-braces, it is the
   update mechanism, and it was measured: with a bump an update lands on the
   next open; without one it can take two, because a page reload may reuse the
   ES modules from the browser's own memory cache without ever consulting this
   worker — `cache: 'reload'` cannot reach that. Changing this file is what
   produces a new worker, and the reload wired up in app.js hangs off that. */

const CACHE_VERSION = 'v25';
const CACHE = `duct-${CACHE_VERSION}`;

const ASSETS = [
  '.',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/engine.js',
  'js/data.js',
  'icon.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Same reasoning as the fetch handler: prime the cache from the network,
      // not from whatever the HTTP cache happens to be holding.
      .then((cache) => cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    // `cache: 'reload'` forces a real network trip, so a deployed update is
    // picked up on the next load rather than whenever the HTTP cache expires.
    fetch(new Request(request, { cache: 'reload' }))
      .then((response) => {
        // Don't poison the offline fallback with an error page.
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match('index.html'))
      )
  );
});
