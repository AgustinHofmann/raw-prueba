import { useEffect, useState } from 'react'
import { Link2, X } from 'lucide-react'
import { compartirProyecto, dejarDeCompartir } from '../lib/db'

interface Props {
  proyectoId: string
  imagen: string
  /** Guarda el proyecto: lo último que se dibujó también tiene que subir. */
  guardar: () => void
  onClose: () => void
  onToast: (m: string) => void
}

/**
 * Crea (o refresca) el link de solo lectura de un proyecto y lo muestra.
 *
 * Los links viven en la cuenta (migración 0009), no en el navegador: por eso
 * esto habla con la base directo y no pasa por repo, que es para lo que se
 * guarda primero acá y se sube después.
 */
export default function CompartirPanel({ proyectoId, imagen, guardar, onClose, onToast }: Props) {
  const [estado, setEstado] = useState<'creando' | 'listo' | 'error' | 'borrado'>('creando')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    guardar()
    ;(async () => {
      // Un proyecto recién creado puede no haber terminado de subir: la base
      // contesta P0002 y se reintenta un par de veces antes de rendirse.
      for (let intento = 0; ; intento++) {
        try {
          const token = await compartirProyecto(proyectoId, imagen)
          if (!vivo) return
          const l = `${location.origin}/#c=${token}`
          setLink(l)
          setEstado('listo')
          navigator.clipboard?.writeText(l).then(() => onToast('Link copiado'), () => {})
          return
        } catch (e) {
          const code = (e as { code?: string })?.code
          if (code === 'P0002' && intento < 2) { await new Promise(r => setTimeout(r, 2500)); if (vivo) continue; return }
          if (!vivo) return
          setError(
            code === 'P0002' ? 'El proyecto todavía no terminó de subir a tu cuenta. Probá de nuevo en un momento.'
            : code === '42501' ? 'Iniciá sesión para compartir.'
            : (e as { message?: string })?.message || 'No se pudo crear el link. Revisá la conexión.',
          )
          setEstado('error')
          return
        }
      }
    })()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc, true)
    return () => { vivo = false; document.removeEventListener('keydown', esc, true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function dejar() {
    try { await dejarDeCompartir(proyectoId); setEstado('borrado') }
    catch { onToast('No se pudo borrar el link. Revisá la conexión.') }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgb(0 0 0 / 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label="Compartir link" onClick={e => e.stopPropagation()}
        style={{ width: 440, maxWidth: '100%', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link2 size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Compartir link</span>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}><X size={16} /></button>
        </div>

        {estado === 'creando' && <p style={{ fontSize: 13, color: 'var(--muted)' }}>Creando el link…</p>}

        {estado === 'listo' && (<>
          <p style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5 }}>
            Quien tenga el link ve una imagen del diseño, sin cuenta y sin poder editarlo.
            Si cambiás el diseño, volvé a compartir: el link es el mismo y se actualiza.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={link} onFocus={e => e.target.select()} aria-label="Link"
              style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 11, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--fg)' }} />
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => navigator.clipboard?.writeText(link).then(() => onToast('Link copiado'), () => onToast('No se pudo copiar: seleccioná el link y copialo a mano'))}>
              Copiar
            </button>
          </div>
          <button className="btn btn-ghost" onClick={dejar} style={{ alignSelf: 'flex-start', fontSize: 12, padding: '6px 10px', color: 'var(--muted)' }}>
            Dejar de compartir
          </button>
        </>)}

        {estado === 'borrado' && <p style={{ fontSize: 13, color: 'var(--fg-2)' }}>Listo: el link ya no abre nada.</p>}
        {estado === 'error' && <p style={{ fontSize: 13, color: '#e0796a', lineHeight: 1.5 }}>{error}</p>}
      </div>
    </div>
  )
}
