/* Coffre — service worker : met l'app en cache pour un fonctionnement hors-ligne. */
const CACHE = 'coffre-premium-v39';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './premium.css',
  './icons-premium.js',
  './app.js',
  './vendor/xlsx.full.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-64.png',
  './icons/apple-touch-icon.png',
  './icons/premium3d/antenna.webp',
  './icons/premium3d/backspace.webp',
  './icons/premium3d/bank.webp',
  './icons/premium3d/beer.webp',
  './icons/premium3d/briefcase.webp',
  './icons/premium3d/broom.webp',
  './icons/premium3d/bulb.webp',
  './icons/premium3d/burger.webp',
  './icons/premium3d/calendar.webp',
  './icons/premium3d/car.webp',
  './icons/premium3d/card.webp',
  './icons/premium3d/cart.webp',
  './icons/premium3d/chart.webp',
  './icons/premium3d/check.webp',
  './icons/premium3d/cigarette.webp',
  './icons/premium3d/clock.webp',
  './icons/premium3d/coat.webp',
  './icons/premium3d/coffee.webp',
  './icons/premium3d/download.webp',
  './icons/premium3d/droplet.webp',
  './icons/premium3d/fish.webp',
  './icons/premium3d/fuel.webp',
  './icons/premium3d/game.webp',
  './icons/premium3d/gift.webp',
  './icons/premium3d/grad.webp',
  './icons/premium3d/handshake.webp',
  './icons/premium3d/hospital.webp',
  './icons/premium3d/house.webp',
  './icons/premium3d/key.webp',
  './icons/premium3d/lock.webp',
  './icons/premium3d/medical.webp',
  './icons/premium3d/moneywings.webp',
  './icons/premium3d/music.webp',
  './icons/premium3d/package.webp',
  './icons/premium3d/paw.webp',
  './icons/premium3d/phone.webp',
  './icons/premium3d/pig.webp',
  './icons/premium3d/pill.webp',
  './icons/premium3d/plane.webp',
  './icons/premium3d/plus.webp',
  './icons/premium3d/receipt.webp',
  './icons/premium3d/repeat.webp',
  './icons/premium3d/search.webp',
  './icons/premium3d/settings.webp',
  './icons/premium3d/shield.webp',
  './icons/premium3d/slot.webp',
  './icons/premium3d/spark.webp',
  './icons/premium3d/stetho.webp',
  './icons/premium3d/tag.webp',
  './icons/premium3d/target.webp',
  './icons/premium3d/trash.webp',
  './icons/premium3d/trophy.webp',
  './icons/premium3d/tv.webp',
  './icons/premium3d/upload.webp',
  './icons/premium3d/warning.webp',
  './icons/premium3d/wrench.webp',
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
