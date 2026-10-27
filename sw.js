/* =====================================================================
 * Service Worker — Sistemas Combinacionales con MUX (PWA)
 * ---------------------------------------------------------------------
 * VERSION se expone tambien al cliente mediante postMessage para que el
 * chip de version del header la muestre dinamicamente. Si el SW aun no
 * controla la pagina (primera carga), el cliente hace fetch de sw.js y
 * extrae VERSION con una regexp como fallback.
 * ===================================================================== */

const VERSION = '1.0.0';
const CACHE_NAME = `mux-combinacional-v${VERSION}`;

/* Recursos del "app shell" propios (mismo origen y scope).
 * Se pre-cachean en el install para que la app funcione offline.
 * Las rutas son RELATIVAS para que, independientemente del subdirectorio
 * donde se publique (p. ej. https://angelmicelti.github.io/mux-app/),
 * el SW solo actue dentro de esa carpeta y nunca interfiera con el
 * portal raiz https://angelmicelti.github.io. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './icons/favicon.ico'
];

/* CDN externos: se cachean en runtime (stale-while-revalidate) pero
 * SOLO dentro de su propio dominio; si la red falla en la primera
 * visita, simplemente se sirve desde red sin caché. Nunca bloquean. */
const RUNTIME_CACHE = 'mux-runtime-v1';
const EXTERNAL_CDN_ORIGINS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

/* ------------------------------------------------------------------ */
/* Install: pre-cachea el app shell.                                   */
/* ------------------------------------------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll falla si un recurso no se puede descargar; usamos un
      // bucle tolerante para no romper el install por un 404 puntual.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.ok) await cache.put(req, res);
          } catch (e) {
            /* recurso opcional no disponible: lo ignoramos */
          }
        })
      );
      // Forzamos la activacion rapida para no requerir dos cargas.
      await self.skipWaiting();
    })()
  );
});

/* ------------------------------------------------------------------ */
/* Activate: limpia caches antiguas y reclama clientes.               */
/* ------------------------------------------------------------------ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------ */
/* Mensaje desde el cliente: pedir VERSION.                           */
/* ------------------------------------------------------------------ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/* ------------------------------------------------------------------ */
/* Helper: ¿la URL esta dentro del scope de esta app?                  */
/* Evita que el SW intercepte recursos del portal padre u otros paths. */
/* ------------------------------------------------------------------ */
function isInScope(urlStr) {
  try {
    const u = new URL(urlStr);
    // Solo mismo origen...
    if (u.origin !== self.location.origin) return false;
    // ...y la ruta empieza con el mismo directorio del SW.
    const swDir = self.location.pathname.replace(/\/[^/]*$/, '/');
    return u.pathname.startsWith(swDir);
  } catch {
    return false;
  }
}

function isExternalCdn(urlStr) {
  try {
    const u = new URL(urlStr);
    return EXTERNAL_CDN_ORIGINS.some((o) => u.origin === o);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Fetch: estrategia mixta.                                            */
/*  - Navegacion (documentos): network-first, fallback a cache y      */
/*    finalmente a index.html (offline app shell).                     */
/*  - Recursos propios del scope: stale-while-revalidate.             */
/*  - CDN externos: stale-while-revalidate en cache de runtime.       */
/*  - Resto: paso a red, sin tocar.                                    */
/* ------------------------------------------------------------------ */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET; ignoramos POST/PUT/etc.
  if (req.method !== 'GET') return;

  const url = req.url;

  // Documentos (navegacion): network-first.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          // Solo cacheamos si la URL esta en scope (no el portal padre).
          if (isInScope(url)) cache.put(req, net.clone());
          return net;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
          return new Response(
            '<h1>Sin conexion</h1><p>No se pudo cargar la app offline.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // Recursos propios del scope: stale-while-revalidate.
  if (isInScope(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
    return;
  }

  // CDN externos: runtime cache stale-while-revalidate (no bloqueante).
  if (isExternalCdn(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
    return;
  }

  // Resto: la red decide, el SW no interfiere.
});
