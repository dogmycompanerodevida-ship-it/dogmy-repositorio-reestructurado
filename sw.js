// DogMy Service Worker - Cache para PWA
const CACHE_NAME = 'dogmy-v9.0';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './paseador.html',
  './seguimiento.html',
  './dueno.html',
  './style.css',
  './script.js',
  './utils.js',
  './qrcode.js',
  './firebase-config.js',
  './logo.jpg',
  './manifest.json'
];

// Archivos que SIEMPRE deben pedirse primero a la red (para que las
// actualizaciones se vean de inmediato). Solo se usa la copia en cache
// si no hay internet en ese momento.
const SIEMPRE_RED_PRIMERO = ['.html', '.js', '.css', '.json'];

// Instalar: guardar archivos en cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: red primero para archivos de codigo, cache primero para el resto
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const esCodigo = SIEMPRE_RED_PRIMERO.some(ext => url.endsWith(ext));
  if (esCodigo) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(resp => resp || fetch(event.request))
    );
  }
});
