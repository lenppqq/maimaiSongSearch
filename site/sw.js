// Offline support: the app shell is served from cache and refreshed in the background;
// song data is fetched from the network first and falls back to the cached copy.
const CACHE = 'mss-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'search.js', 'i18n.js', 'icon.svg', 'manifest.webmanifest', 'data/songs.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const cache = caches.open(CACHE);
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { if (res.ok) { const copy = res.clone(); cache.then((c) => c.put(e.request, copy)); } return res; })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const network = fetch(e.request)
        .then((res) => { if (res.ok) { const copy = res.clone(); cache.then((c) => c.put(e.request, copy)); } return res; })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
