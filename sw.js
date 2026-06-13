// Meza service worker — offline app shell + cache-first static assets.
// Live data (Supabase REST/Realtime, ESM CDN) ALWAYS goes to the network so the
// bill-splitting state is never stale. Bump CACHE to invalidate old caches.
const CACHE = 'meza-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {})) // tolerate a missing asset
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Never intercept writes (Supabase POST/PATCH/DELETE, etc.) — let them hit the network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Live backends must always be fresh — do not touch them.
  if (!sameOrigin && /(^|\.)supabase\.(co|in)$|(^|\.)esm\.sh$/i.test(url.hostname)) {
    return; // browser handles normally (network)
  }

  // App shell / page navigations: network-first so new deploys land immediately,
  // falling back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Same-origin static assets (icons, manifest): cache-first.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
      )
    );
    return;
  }

  // Cross-origin static deps (fonts, CDN scripts): cache-first, network fallback.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
