/* Coffre — service worker : met l'app en cache pour un fonctionnement hors-ligne. */
const CACHE = 'coffre-v26';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './vendor/xlsx.full.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// Le bouton "Mettre à jour" de l'appli demande au nouveau worker de prendre la main.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isCore = e.request.mode === 'navigate'
    || (/\.(html|js|css|webmanifest)$/.test(url.pathname) && !url.pathname.includes('/vendor/'));

  if (isCore) {
    // Réseau d'abord, en CONTOURNANT le cache HTTP du navigateur (no-store) : sinon il pouvait
    // resservir un ancien app.js et bloquer la mise à jour. Le cache SW sert de secours hors-ligne.
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
  } else {
    // Cache d'abord pour le reste (SheetJS, icônes) : lourd et figé.
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
