/* Metro PWA service worker — app shell only.
   WMATA API calls (api.wmata.com) are NEVER cached: predictions always come fresh from the network. */
var CACHE = 'metro-pwa-v7';
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
  // App shell (same origin, known paths): cache-first, network fallback.
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
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request);
    })
  );
});
