'use strict';

// Service worker mínimo para que el CRM sea instalable como app (PWA).
// Estrategia: RED PRIMERO. Los datos (API, chats, páginas del cliente) van
// siempre por red; solo se guarda en caché el "esqueleto" (HTML/CSS/JS/iconos)
// para poder abrir la app sin conexión. Así nunca se muestran datos viejos.

const CACHE = 'bz-crm-v5';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/favicon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // envíos (POST/PUT/DELETE) → red directa
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Datos en vivo: nunca desde caché.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/estado')
      || url.pathname.startsWith('/reservar') || url.pathname === '/webhook') return;
  // Recursos de la app: red primero; caché solo como respaldo sin conexión.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
  );
});
