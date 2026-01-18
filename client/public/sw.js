/**
 * Service Worker - Weather Consensus PWA
 * Provides offline caching and background sync
 */

const CACHE_NAME = 'weather-consensus-v1';
const ECCC_CACHE_TTL_MS = 5 * 60 * 1000;
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/images/hero-aurora.png',
  '/images/topo-pattern.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API requests - network only with timeout
  if (url.hostname.includes('api.open-meteo.com') || 
      url.hostname.includes('geocoding-api.open-meteo.com')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses briefly
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if available
          return caches.match(request);
        })
    );
    return;
  }

  // ECCC proxy - pass through
  if (url.pathname.startsWith('/api/eccc/location')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const metaKey = `${request.url}::meta`;
        const cachedMeta = await cache.match(metaKey);
        const cachedResponse = await cache.match(request);
        if (cachedMeta && cachedResponse) {
          const cachedAt = Number(await cachedMeta.text());
          if (Number.isFinite(cachedAt) && Date.now() - cachedAt < ECCC_CACHE_TTL_MS) {
            return cachedResponse;
          }
        }

        try {
          const response = await fetch(request);
          if (response.status === 304 && cachedResponse) return cachedResponse;
          if (response.ok) {
            const clone = response.clone();
            cache.put(request, clone);
            cache.put(metaKey, new Response(Date.now().toString()));
          }
          return response;
        } catch {
          if (cachedResponse) return cachedResponse;
          throw new Error('ECCC proxy fetch failed');
        }
      })
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Update cache in background
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, response);
            });
          }
        });
        return cachedResponse;
      }

      // Not in cache - fetch from network
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
