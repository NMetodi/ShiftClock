// Offline support: answer from cache at once (no hang on weak signal), refresh the cache in the background.
// An update therefore shows on the next launch.
const CACHE = 'shiftclock-8'; // bump on every release so phones pick up the update
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'store.js', 'export.js', 'manifest.webmanifest', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const fresh = fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fresh));
});
