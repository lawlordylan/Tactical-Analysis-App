// Service worker: makes the app work offline after the first visit.
// The cache version and precache list below are filled in by scripts/build.mjs.
const CACHE = 'tactical-analysis-__VERSION__';
const PRECACHE = __PRECACHE__;
// Player-finder runtime and model: cached on first use, kept across app updates
// until the runtime version changes.
const DETECTOR_CACHE = 'ta-detector-__DETECTOR_VERSION__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith('tactical-analysis-') && k !== CACHE) || (k.startsWith('ta-detector-') && k !== DETECTOR_CACHE))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Pages: network first so updates arrive when online, cache when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Player finder files: cache on first use.
  if (new URL(req.url).pathname.includes('/detector/')) {
    event.respondWith(
      caches.open(DETECTOR_CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Hashed assets and icons: cache first.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
