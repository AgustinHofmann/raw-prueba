import { useState } from 'react'
import { Project } from '../types/project'
import Sidebar from '../components/Sidebar'
import Magnetic from '../components/Magnetic'

type Route = 'home' | 'library' | 'export' | 'editor' | 'onboard'

const formats = [
  { k: 'png', label: 'PNG', note: 'transparente' },
  { k: 'jpg', label: 'JPG', note: 'fondo plano'  },
  { k: 'svg', label: 'SVG', note: 'vectorial'    },
  { k: 'pdf', label: 'PDF', note: 'para imprenta' },
]

const sizes = ['1x', '2x', '3x', '4x'] as const
const pxMap: Record<string, number> = { '1x': 800, '2x': 1600, '3x': 2400, '4x': 3200 }

export default function ExportScreen({ project, onGo, onBack }: {
  project: Project
  onGo: (r: Route) => void
  onBack: () => void
}) {
  const [format, setFormat] = useState('png')
  const [size, setSize]     = useState('2x')

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)', overflow: 'hidden' }}>
      <Sidebar onGo={onGo} active="export" />
      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.4fr 1fr', overflow: 'hidden' }}>
        <div className="rise" style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-2)', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(circle, var(--line-soft) 1px, transparent 1px)',
            backgroundSize: '20px 20px', opacity: 0.4,
          }} />
          <div style={{
            width: 'min(420px, 70%)', aspectRatio: '1', background: 'var(--surface)',
            borderRadius: 16, boxShadow: 'var(--shadow-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: 'rotate(-1deg)', animation: 'rise 0.7s var(--ease) both',
          }}>
            <img src={`/mockups/${project.mockupId}.svg`}
              style={{ width: '70%', height: '70%', objectFit: 'contain', filter: 'drop-shadow(0 30px 50px rgb(0 0 0 / 0.4))' }} />
          </div>
        </div>

        <div style={{ padding: '44px 40px', overflowY: 'auto', borderLeft: '1px solid var(--line-soft)' }}>
          <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 24, padding: '6px 8px' }}>← Volver</button>
          <div className="label rise" style={{ marginBottom: 10 }}>Exportar</div>
          <h1 className="display rise" style={{ fontSize: 56, marginBottom: 24 }}>
            Listo para <span className="display-i" style={{ color: 'var(--accent)' }}>compartir</span>.
          </h1>

          <div className="rise-2" style={{ marginBottom: 28 }}>
            <div className="label" style={{ marginBottom: 10 }}>Formato</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {formats.map(f => (
                <button key={f.k} onClick={() => setFormat(f.k)} style={{
                  padding: 14, borderRadius: 10, textAlign: 'left',
                  background: format === f.k ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  border: '1.5px solid ' + (format === f.k ? 'var(--accent)' : 'var(--line)'),
                  cursor: 'pointer', fontFamily: 'inherit', color: 'var(--fg)',
                  transition: 'all 0.2s var(--ease)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: 22 }}>{f.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{f.note}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rise-3" style={{ marginBottom: 28 }}>
            <div className="label" style={{ marginBottom: 10 }}>Tamaño</div>
            <div className="seg" style={{ width: '100%' }}>
              {sizes.map(s => (
                <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)} style={{ flex: 1 }}>{s}</button>
              ))}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              800 × 800 px → {pxMap[size]} × {pxMap[size]} px
            </div>
          </div>

          <div className="rise-4">
            <Magnetic strength={6}>
              <button className="btn btn-primary" style={{ padding: '12px 20px', fontSize: 14, width: '100%', justifyContent: 'center' }}>
                Descargar {format.toUpperCase()} ↓
              </button>
            </Magnetic>
          </div>
        </div>
      </main>
    </div>
  )
}
