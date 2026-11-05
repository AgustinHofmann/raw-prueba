import { useState } from 'react'
import { Project, Folder } from '../types/project'
import Magnetic from '../components/Magnetic'
import { PLANTILLAS, plantillaPorId } from '../lib/plantillas'

const MOCKUPS = [
  { id: 'tshirt' as const, label: 'Remera',   icon: '/mockups/tshirt.svg' },
  { id: 'chomba' as const, label: 'Chomba',   icon: '/mockups/chomba.svg' },
  { id: 'pants'  as const, label: 'Pantalón', icon: '/mockups/pants.svg'  },
  { id: 'musculosa' as const, label: 'Musculosa', icon: '/mockups/musculosa.svg' },
  { id: 'short'  as const, label: 'Short',    icon: '/mockups/short.svg'  },
]

interface Props {
  folders: Folder[]
  onConfirm: (p: Project) => void
  onCancel: () => void
}

export default function NewProjectSheet({ folders, onConfirm, onCancel }: Props) {
  const [name, setName]       = useState('Sin título')
  const [mockup, setMockup]   = useState<Project['mockupId']>('tshirt')
  const [folderId, setFolder] = useState<string | null>(null)
  const [plantilla, setPlantilla] = useState<string | null>(null)

  // Una plantilla trae su prenda. Elegir otra prenda después la descarta: sus
  // textos están ubicados para esa prenda y no para cualquiera.
  function elegirPlantilla(id: string | null) {
    setPlantilla(id)
    const p = plantillaPorId(id)
    if (!p) return
    setMockup(p.mockupId)
    if (name === 'Sin título' || PLANTILLAS.some(x => x.nombre === name)) setName(p.nombre)
  }
  function elegirPrenda(id: Project['mockupId']) {
    setMockup(id)
    if (plantillaPorId(plantilla)?.mockupId !== id) setPlantilla(null)
  }

  function handleCreate() {
    const now = Date.now()
    onConfirm({
      id: crypto.randomUUID(),
      name: name.trim() || 'Sin título',
      mockupId: mockup,
      thumbnail: null,
      canvasJson: null,
      techpackJson: null,
      colors: [],
      tag: 'Activo',
      folderId,
      createdAt: now,
      updatedAt: now,
      ...(plantilla ? { plantilla } : {}),
    })
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'flex-end',
        animation: 'rise 0.25s var(--ease) both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420, height: '100%', background: 'var(--bg)',
          borderLeft: '1px solid var(--line)', padding: '40px 36px',
          display: 'flex', flexDirection: 'column', gap: 28,
          overflowY: 'auto', animation: 'sheet-in 0.35s var(--ease) both',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="label">Nuevo proyecto</div>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontSize: 16, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Name */}
        <div>
          <div className="label" style={{ marginBottom: 10 }}>Nombre</div>
          <input
            className="display-i"
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={e => e.target.select()}
            autoFocus
            style={{
              width: '100%', background: 'transparent', border: 'none',
              borderBottom: '2px solid var(--accent)', outline: 'none',
              fontSize: 32, color: 'var(--fg)', fontFamily: 'var(--display)',
              padding: '4px 0', fontStyle: 'italic', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Para no arrancar de una prenda vacía: ver algo armado enseña más
            rápido qué se puede hacer que cualquier explicación. */}
        <div>
          <div className="label" style={{ marginBottom: 10 }}>Empezar con</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[{ id: null, nombre: 'En blanco', descripcion: 'Solo la prenda', color: null as string | null }, ...PLANTILLAS].map(p => {
              const activa = plantilla === p.id
              return (
                <button key={p.id ?? 'blanco'} onClick={() => elegirPlantilla(p.id)} style={{
                  padding: '10px 12px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  background: activa ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  border: '1.5px solid ' + (activa ? 'var(--accent)' : 'var(--line)'),
                  fontFamily: 'var(--ui)', color: 'var(--fg)', transition: 'all 0.15s var(--ease)',
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: p.color ?? 'transparent',
                    border: '1px ' + (p.color ? 'solid' : 'dashed') + ' var(--line)',
                  }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12 }}>{p.nombre}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.3, marginTop: 2 }}>{p.descripcion}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Garment */}
        <div>
          <div className="label" style={{ marginBottom: 10 }}>Prenda</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {MOCKUPS.map(m => (
              <button key={m.id} onClick={() => elegirPrenda(m.id)} style={{
                padding: '16px 8px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                background: mockup === m.id ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                border: '1.5px solid ' + (mockup === m.id ? 'var(--accent)' : 'var(--line)'),
                fontFamily: 'var(--ui)', color: 'var(--fg)', transition: 'all 0.2s var(--ease)',
              }}>
                <img src={m.icon} alt={m.label} style={{ width: 52, height: 52, objectFit: 'contain', filter: 'drop-shadow(0 4px 8px rgb(0 0 0 / 0.3))' }} />
                <span style={{ fontSize: 12 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Folder */}
        {folders.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 10 }}>Carpeta</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => setFolder(null)}
                style={{
                  padding: '9px 14px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: folderId === null ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                  border: '1.5px solid ' + (folderId === null ? 'var(--accent)' : 'var(--line)'),
                  fontFamily: 'var(--ui)', color: 'var(--fg)', fontSize: 13,
                  transition: 'all 0.15s var(--ease)', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 16 }}>—</span>
                <span style={{ color: 'var(--muted)' }}>Sin carpeta</span>
              </button>
              {folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFolder(f.id)}
                  style={{
                    padding: '9px 14px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: folderId === f.id ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                    border: '1.5px solid ' + (folderId === f.id ? 'var(--accent)' : 'var(--line)'),
                    fontFamily: 'var(--ui)', color: 'var(--fg)', fontSize: 13,
                    transition: 'all 0.15s var(--ease)', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 16 }}>📁</span>
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <Magnetic strength={6}>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              style={{ width: '100%', justifyContent: 'center', padding: '13px 20px', fontSize: 14 }}
            >
              Crear proyecto →
            </button>
          </Magnetic>
        </div>
      </div>
    </div>
  )
}
