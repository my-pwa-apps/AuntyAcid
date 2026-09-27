const CACHE_NAME = 'auntyacid-v30';
const VERSION = CACHE_NAME.replace('auntyacid-', '');
// Comic images are kept across app versions so previously viewed comics work offline.
const IMAGE_CACHE_NAME = 'auntyacid-images-v1';
const IMAGE_CACHE_LIMIT = 150;
const IMAGE_HOSTS = ['featureassets.gocomics.com'];

// Assets to cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './core.js',
  './app.js',
  './main.css',
  './manifest.webmanifest',
  './aunytacidlogo.png',
  './favicon-48x48.png',
  './manifest-icon-192.maskable.png',
  './manifest-icon-512.maskable.png'
];

// Install event - cache core assets. skipWaiting() is deliberately NOT called here: the new
// worker waits until the user accepts the in-app update banner (SKIP_WAITING message) instead of
// taking over (and deleting the old cache under) a page that is still open.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS.map(asset => new Request(asset, { cache: 'reload' }))))
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map(key => cache.delete(key)));
}

// Comic images are immutable per URL: cache-first, only CORS (non-opaque) successful responses.
function handleComicImage(event) {
  event.respondWith(
    caches.open(IMAGE_CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok && response.type === 'cors') {
            const copy = response.clone();
            event.waitUntil(
              cache.put(event.request, copy)
                .then(() => trimCache(IMAGE_CACHE_NAME, IMAGE_CACHE_LIMIT))
                .catch(() => {})
            );
          }
          return response;
        });
      })
    )
  );
}

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (IMAGE_HOSTS.includes(url.hostname) && event.request.mode === 'cors') {
    handleComicImage(event);
    return;
  }

  // Skip other cross-origin requests (CORS proxy, analytics)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Handle navigation requests (HTML pages) - always serve index.html for SPA
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then(cachedResponse => {
          if (cachedResponse) {
            // Update cache in background
            event.waitUntil(
              fetch('./index.html')
                .then(response => {
                  if (response && response.status === 200) {
                    return caches.open(CACHE_NAME)
                      .then(cache => cache.put('./index.html', response));
                  }
                })
                .catch(() => {})
            );
            return cachedResponse;
          }
          return fetch('./index.html');
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached version and update cache in background
          event.waitUntil(
            fetch(event.request)
              .then(response => {
                if (response && response.status === 200) {
                  const responseClone = response.clone();
                  return caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseClone));
                }
              })
              .catch(() => {})
          );
          return cachedResponse;
        }

        // Not in cache - fetch from network
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) {
              return response;
            }

            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseClone));

            return response;
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'VERSION', version: VERSION });
  }
});
