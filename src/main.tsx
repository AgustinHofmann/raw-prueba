import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// El service worker hace que la app sea instalable y que abra sin internet,
// guardándose una copia de todo. Eso es justo lo que NO se quiere mientras se
// desarrolla: la copia guardada le gana a la versión nueva y la pantalla queda
// congelada en una versión vieja por más que se recargue.
//
// Así que en desarrollo no solo no se registra: se da de baja el que hubiera
// quedado de antes y se borra su copia. Si no, un service worker viejo sigue
// mandando para siempre en ese navegador.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  } else {
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.map(r => r.unregister())))
      .then(() => caches?.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
      .catch(() => {})
  }
}
