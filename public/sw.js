const CACHE_NAME = 'inkwell-v21';
const SHARE_CACHE = 'inkwell-shared'; /* holds a photo shared into Inkwell Drop */
const STATIC_ASSETS = [
  '/manifest.json',
  '/capture.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  /* Skip waiting immediately so new SW takes over */
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  /* Claim all clients immediately + purge ALL old caches */
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Web Share Target (Inkwell Drop): Android POSTs the shared photo here.
  // Stash it in a cache, then redirect to /capture which picks it up.
  if (event.request.method === 'POST' && url.pathname === '/capture/share') {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const file = form.get('photo');
        if (file && file.size) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put('/__shared-photo', new Response(file, {
            headers: { 'Content-Type': file.type || 'image/jpeg' }
          }));
          return Response.redirect('/capture?shared=1', 303);
        }
        return Response.redirect('/capture?shared=missed', 303);
      } catch (e) {
        return Response.redirect('/capture?shared=missed', 303);
      }
    })());
    return;
  }

  // Never intercept/cache other non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API and Supabase requests entirely — always network
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  // Static assets (icons, manifest) — cache-first
  if (STATIC_ASSETS.some(a => url.pathname === a)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Everything else (HTML, JS, CSS) — NETWORK-FIRST
  // Always try network; only fall back to cache if offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
