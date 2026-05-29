/* Ten-Level Chinese — service worker
   - App shell (html/js/css/json): stale-while-revalidate, so a new deploy
     shows up on the next load instead of trapping users on an old version.
   - Audio clips, icons, fonts, CDN libs: cache-first (effectively immutable).
   Bump CACHE when the shell list changes. */
const CACHE = 'tlc-v2';

const SHELL = [
  './',
  'index.html',
  'assets/styles.css',
  'assets/app.js',
  'data/lessons.json',
  'assets/audio/manifest.json',
  'manifest.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Is this an "app shell" file we want kept fresh? (same-origin only)
function isShellRequest(url) {
  return url.origin === self.location.origin &&
    (/\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/'));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell → stale-while-revalidate
  if (isShellRequest(url)) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => null);
        return cached || (await network) || cache.match('index.html');
      })
    );
    return;
  }

  // Everything else (audio, icons, fonts, CDN) → cache-first
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // cache same-origin assets and opaque cross-origin (fonts/CDN/audio)
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return cached || Response.error();
      }
    })
  );
});
