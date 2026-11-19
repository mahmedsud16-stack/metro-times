/* Metro PWA service worker — app shell only.
   WMATA API calls (api.wmata.com) are NEVER cached: predictions always come fresh from the network.
   Shell files are NETWORK-FIRST (v16+): a stale or bad saved copy can never
   strand the app — the network wins whenever it answers, and the saved copy
   is only the offline fallback. (v15 and earlier were cache-first, which let
   a bad saved copy brick the station list until the cache was cleared.) */
var CACHE = 'metro-pwa-v18';
var SHELL = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './stations.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // Live WMATA predictions: network-only, never cached.
  if (url.hostname === 'api.wmata.com') return;
  // App shell (same origin, known paths): NETWORK-FIRST, cache fallback.
  // NOTE: this site is deployed under the /metro-times/ subpath, so a shell
  // file's real path is '/metro-times/stations.json', not '/stations.json'.
  // Match against the registration scope so the cache is actually served.
  var path = url.pathname;
  var scopeBase = new URL(self.registration.scope).pathname.replace(/\/$/, '');
  var isShell = SHELL.some(function (p) {
    var norm = p.replace(/^\.\//, '/');
    if (p === './') return path === '/' || path === scopeBase + '/' || path === scopeBase;
    return path === norm || path === scopeBase + norm || path.endsWith(norm);
  });
  if (!isShell) return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.ok) {
        // Good network answer: refresh the saved copy, then serve it.
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      }
      // Network answered but not OK (e.g. a 404 while a deploy is
      // publishing): fall back to the saved copy, and only then to the
      // network response itself.
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || resp;
      });
    }).catch(function () {
      // Offline / network error: serve the saved copy if there is one.
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
