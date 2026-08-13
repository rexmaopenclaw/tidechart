// SeaCast PWA service worker — cache static assets for offline, never cache API data
const CACHE = 'seacast-v2';
const CORE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache API responses (tide/current/wind data must stay live)
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin (Leaflet CDN / OSM tiles): cache-first, fallback network
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          // Only cache successful, non-tile responses (avoid huge tile cache)
          if (res.ok && !url.hostname.includes('tile.openstreetmap')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Same-origin static: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetched = fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fetched;
    })
  );
});
