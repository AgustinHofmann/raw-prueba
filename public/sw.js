// Service worker: lo que hace que la app abra sin internet.
//
// Antes era un passthrough: dejaba pasar todo a la red. Servía para poder
// instalar la app, pero abrirla sin conexión daba el dinosaurio del navegador.
//
// Estrategia, distinta según qué se pide:
//
// - El documento HTML: primero la red, y si no hay, la copia guardada. Así una
//   versión nueva se ve apenas está, y sin internet igual abre.
// - Todo lo demás del mismo dominio (JS, CSS, telas, mockups, tipografías):
//   primero la copia guardada. Vite le pone un hash al nombre de cada archivo,
//   así que si el contenido cambia, cambia el nombre: servir la copia guardada
//   nunca devuelve algo viejo.
// - Lo que va a otro dominio (Supabase, Google Fonts): no se toca. Cachear
//   respuestas de la base sería servir datos viejos como si fueran actuales.

const CACHE = 'raw-design-v1'

// Lo mínimo para que la app arranque estando sin conexión.
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si UN archivo falla; acá se agrega de a uno para que
      // un 404 suelto no deje la app sin nada guardado.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // Supabase y demás: sin tocar

  // Documento: red primero, copia guardada como red de emergencia.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone()
          caches.open(CACHE).then(c => c.put('/index.html', copia)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html').then(r => r ?? Response.error())),
    )
    return
  }

  // Recursos: copia guardada primero; si no está, se baja y se guarda.
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit
      return fetch(req).then(res => {
        // Solo se guardan las respuestas buenas: guardar un 404 o una respuesta
        // parcial dejaría el error congelado para siempre.
        if (res.ok && res.status === 200) {
          const copia = res.clone()
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {})
        }
        return res
      })
    }),
  )
})
