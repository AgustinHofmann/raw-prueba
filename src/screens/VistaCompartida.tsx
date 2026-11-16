import { useEffect, useState } from 'react'
import { verCompartido } from '../lib/db'
import { cloudEnabled } from '../lib/supabase'
import { garmentName } from '../lib/techpackTemplate'
import type { Project } from '../types/project'

/**
 * Lo que ve quien abre un link compartido (…/#c=<token>): el diseño, su nombre
 * y la prenda. Sin cuenta, sin editor y sin nada del resto de la app: es para
 * mandárselo a un cliente o al taller.
 */
export default function VistaCompartida({ token }: { token: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof verCompartido>> | 'cargando' | 'error'>('cargando')

  useEffect(() => {
    if (!cloudEnabled) { setD(null); return }
    verCompartido(token).then(setD, () => setD('error'))
  }, [token])

  const fecha = d && typeof d === 'object'
    ? new Date(d.actualizado).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', boxSizing: 'border-box', gap: 18 }}>
      <a href="/" style={{ fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: 22, color: 'var(--fg)', textDecoration: 'none' }}>
        R<span style={{ color: 'var(--accent)' }}>·</span>AW
      </a>

      {d === 'cargando' && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Cargando el diseño…</p>}
      {d === 'error' && <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>No se pudo cargar el diseño. Revisá la conexión y volvé a abrir el link.</p>}
      {d === null && <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>Este link no existe o lo dejaron de compartir.</p>}

      {d && typeof d === 'object' && (
        <main style={{ width: '100%', maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h1 className="display-i" style={{ fontSize: 30, margin: 0, overflowWrap: 'anywhere' }}>{d.nombre}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              {garmentName(d.prenda as Project['mockupId'])} · compartido el {fecha}
            </p>
          </div>
          <img src={d.imagen} alt={`Diseño: ${d.nombre}`}
            style={{ width: '100%', height: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', background: '#fff' }} />
        </main>
      )}

      <a href="/" style={{ marginTop: 'auto', fontSize: 12, color: 'var(--muted)' }}>Hecho con RAW Design</a>
    </div>
  )
}
