// ponytail: hand-rolled SW — no @angular/pwa; versioned cache; offline fallback.
// NETWORK-FIRST: always prefer fresh so a new build/code is never masked by a
// stale cached bundle (the old cache-first strategy served stale JS forever,
// which hid shipped fixes until the cache was manually cleared). Cache is only
// a fallback for offline.
const CACHE_NAME = 'kaliwat-shell-v2';
const SHELL_URLS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('kaliwat-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Only handle same-origin requests; remote photo fetches go straight to the
  // network (and are cached by the app into IndexedDB, not here).
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(request)
      .then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return resp;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('/index.html').then((idx) => idx ?? Response.error());
          }
          return Response.error();
        }),
      ),
  );
});
