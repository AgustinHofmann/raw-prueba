// Service worker mínimo: habilita la instalación como app (PWA).
// Passthrough — no cachea para no interferir con el desarrollo ni servir contenido viejo.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* dejar pasar a la red */ })
