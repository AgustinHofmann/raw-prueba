// SERVICE WORKER DE AUTODESTRUCCIÓN.
//
// El anterior guardaba una copia de la app para poder abrirla sin internet, y esa
// copia terminó ganándole a la versión nueva: la pantalla quedaba en negro o
// congelada en una versión vieja, y no había forma de salir recargando, porque
// el propio service worker respondía antes de que la app llegara a ejecutarse.
//
// El navegador SIEMPRE vuelve a pedir este archivo por red (no pasa por la
// copia guardada), así que este es el único lugar desde el que se puede
// desactivar sin tocar nada a mano. Se da de baja solo, borra todas las copias
// y recarga las pestañas abiertas.
//
// No se borra este archivo: si no existiera, el navegador dejaría al viejo
// funcionando. Tiene que existir y tiene que desactivarse.
//
// El modo sin conexión NO depende de esto: los proyectos viven en IndexedDB
// (ver src/lib/idb.ts). Lo único que se pierde es abrir la app con el navegador
// cerrado sin internet. Si algún día se quiere de nuevo, hay que rehacerlo
// dejando SIEMPRE el documento contra la red primero.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const nombres = await caches.keys()
      await Promise.all(nombres.map(n => caches.delete(n)))
    } catch { /* si no se puede borrar, igual hay que darse de baja */ }

    try { await self.registration.unregister() } catch { /* ya estaba */ }

    // Recargar lo que esté abierto: esas pestañas todavía están mostrando lo
    // que servía el service worker viejo.
    try {
      const clientes = await self.clients.matchAll({ type: 'window' })
      for (const c of clientes) c.navigate(c.url)
    } catch { /* sin permiso para navegar: alcanza con la próxima recarga */ }
  })())
})

// Mientras siga vivo, todo va derecho a la red. Nada se responde desde copias.
self.addEventListener('fetch', () => { /* sin interceptar */ })
