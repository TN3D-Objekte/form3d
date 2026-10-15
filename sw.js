// Offline-Cache: Netz zuerst (damit Updates sofort ankommen), sonst aus dem Cache.
// Service Worker laufen nur über HTTPS oder localhost.
const CACHE = 'form3d-v7';
const SHELL = [
  './', 'index.html', 'datenschutz.html', 'manifest.json', 'css/app.css',
  'js/main.js', 'js/viewport.js', 'js/kernel.js', 'js/sketch.js', 'js/meshview.js', 'js/edges.js', 'js/solver.js', 'js/doc.js', 'js/ui.js', 'js/exporters.js', 'js/bugrec.js', 'js/printcheck.js', 'js/parts.js',
  'vendor/three.module.js', 'vendor/TransformControls.js', 'vendor/manifold.js', 'vendor/manifold.wasm',
  'icons/icon-180.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
