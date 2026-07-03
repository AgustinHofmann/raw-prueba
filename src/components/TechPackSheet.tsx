import { useState } from 'react'
import type { Project, TechPackMeasures } from '../types/project'

export type { TechPackMeasures }

const MEAS_ROWS: { key: keyof TechPackMeasures; label: string; code: string }[] = [
  { key: 'largoTotal',        label: 'Largo total',          code: 'A' },
  { key: 'anchoPecho',        label: 'Ancho de pecho',       code: 'B' },
  { key: 'anchoCintura',      label: 'Ancho de cintura',     code: 'C' },
  { key: 'anchoCuello',       label: 'Ancho de cuello',      code: 'D' },
  { key: 'profundidadCuello', label: 'Profundidad de cuello', code: 'E' },
  { key: 'largoManga',        label: 'Largo de manga',       code: 'F' },
  { key: 'anchoManga',        label: 'Ancho de manga',       code: 'G' },
]

const DEFAULT_NOTES = 'Tela: jersey de algodón 180gr. Costuras: overlock. Cuello: ribb 1x1. Etiqueta interior estampada.'
const DEFAULT_BOM = '• Tela principal — algodón 100%\n• Hilo — poliéster tono a tono\n• Etiqueta de marca — tejida'

interface BodyProps {
  project: Project
  designer: string
  garmentImg: string
  measures: TechPackMeasures | null
}

// Hoja A4 de la ficha técnica. Reutilizable: la usa el modal TechPackSheet
// y la pantalla completa TechPackScreen (modo Tech Pack en pestaña interna).
export function TechPackSheetBody({ project, designer, garmentImg, measures }: BodyProps) {
  const [notes, setNotes] = useState(DEFAULT_NOTES)
  const [bom, setBom] = useState(DEFAULT_BOM)
  const styleNo = `RAW-${project.id.slice(0, 6).toUpperCase()}`
  const date = new Date(project.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const garmentName = project.mockupId === 'tshirt' ? 'Remera' : project.mockupId === 'hoodie' ? 'Buzo' : 'Pantalón'

  const cell: React.CSSProperties = { border: '1px solid #999', padding: '5px 8px', fontSize: 11 }

  return (
    <div
      id="techpack-print"
      style={{
        width: 794, minHeight: 1123, background: '#fff', color: '#111',
        padding: 40, boxSizing: 'border-box', fontFamily: 'Arial, sans-serif',
        boxShadow: '0 20px 60px rgb(0 0 0 / 0.5)',
      }}
    >
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #111', paddingBottom: 12 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>RAW <span style={{ color: '#7a8c00' }}>Design</span></div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Ficha técnica · Tech Pack</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.7 }}>
          <div><b>Estilo:</b> {project.name}</div>
          <div><b>Código:</b> {styleNo}</div>
          <div><b>Prenda:</b> {garmentName}{project.tag ? ` · ${project.tag}` : ''}</div>
          <div><b>Fecha:</b> {date}</div>
          <div><b>Diseñador:</b> {designer}</div>
        </div>
      </div>

      {/* Vista de la prenda */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Vista frontal</div>
        <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 10, textAlign: 'center', background: '#fafafa' }}>
          <img src={garmentImg} alt="Prenda" style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }} />
        </div>
      </div>

      {/* Medidas + Colorway */}
      <div style={{ display: 'flex', gap: 18, marginTop: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: 1.4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Tabla de medidas (cm)</div>
          {measures ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ background: '#111', color: '#fff' }}>
                  <th style={{ ...cell, borderColor: '#111' }}>#</th>
                  <th style={{ ...cell, borderColor: '#111', textAlign: 'left' }}>Punto de medida</th>
                  <th style={{ ...cell, borderColor: '#111' }}>cm</th>
                </tr>
              </thead>
              <tbody>
                {MEAS_ROWS.map(r => (
                  <tr key={r.key}>
                    <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{r.code}</td>
                    <td style={cell}>{r.label}</td>
                    <td style={{ ...cell, textAlign: 'right', fontFamily: 'monospace' }}>{measures[r.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 11, color: '#888' }}>Medidas disponibles solo para la remera paramétrica.</div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Colorway</div>
          {project.colors && project.colors.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {project.colors.map((c, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ width: 46, height: 46, background: c, border: '1px solid #999', borderRadius: 4 }} />
                  <div style={{ fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{c}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#888' }}>Sin colores definidos.</div>
          )}
        </div>
      </div>

      {/* BOM + Notas (editables) */}
      <div style={{ display: 'flex', gap: 18, marginTop: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Materiales (BOM)</div>
          <textarea value={bom} onChange={e => setBom(e.target.value)}
            style={{ width: '100%', minHeight: 90, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 11, fontFamily: 'Arial', resize: 'vertical', color: '#111', background: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Construcción / Notas</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            style={{ width: '100%', minHeight: 90, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 11, fontFamily: 'Arial', resize: 'vertical', color: '#111', background: '#fff' }} />
        </div>
      </div>

      {/* Pie */}
      <div style={{ borderTop: '1px solid #ccc', marginTop: 22, paddingTop: 8, fontSize: 9, color: '#999', display: 'flex', justifyContent: 'space-between' }}>
        <span>RAW Design — Tech Pack generado automáticamente</span>
        <span>{styleNo} · {date}</span>
      </div>
    </div>
  )
}

interface Props extends BodyProps {
  onClose: () => void
}

// Modal de vista rápida de la ficha (se mantiene por compatibilidad; el modo
// principal ahora es la pestaña interna TechPackScreen).
export default function TechPackSheet({ project, designer, garmentImg, measures, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      className="no-print"
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgb(0 0 0 / 0.6)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        overflowY: 'auto', padding: '24px 0',
      }}
    >
      {/* Barra de acciones */}
      <div className="no-print" onClick={e => e.stopPropagation()}
        style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: 13 }}>🖨 Exportar PDF / Imprimir</button>
        <button onClick={onClose} className="btn" style={{ fontSize: 13 }}>Cerrar</button>
      </div>

      <div onClick={e => e.stopPropagation()}>
        <TechPackSheetBody project={project} designer={designer} garmentImg={garmentImg} measures={measures} />
      </div>
    </div>
  )
}
