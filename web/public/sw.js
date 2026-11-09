// Forage's service worker: makes the app installable and lets it open offline. Network first,
// so updates show right away; the cache is only a fallback. Supabase calls aren't touched.
const CACHE = 'forage-v1';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        // Shared text opens ./?text=…, which isn't cached as such: fall back to the app.
        const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
        return cached ?? (request.mode === 'navigate' ? caches.match('./') : Response.error());
      }),
  );
});
