import { TechPackSheetBody } from '../components/TechPackSheet'
import type { Project, TechPackMeasures } from '../types/project'

interface Props {
  project: Project
  designer: string
  snapshot: string
  measures: TechPackMeasures | null
  onBackToEditor: () => void
  onClose: () => void
}

// Modo Tech Pack: pantalla completa que vive como pestaña interna de la app,
// en paralelo con el editor. Fase 1: plantilla editable en memoria + exportar PDF.
// (Fases siguientes: persistencia, secciones reordenables, BOM/POM, imágenes,
//  anotaciones visuales ancladas a la prenda.)
export default function TechPackScreen({ project, designer, snapshot, measures, onBackToEditor, onClose }: Props) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Barra de herramientas (no se imprime) */}
      <div className="no-print" style={{
        flexShrink: 0, height: 48, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 18px', borderBottom: '1px solid var(--line-soft)', background: 'var(--bg)',
      }}>
        <button
          onClick={onBackToEditor}
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← Volver al editor
        </button>

        <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 15 }}>📄</span>
          <span className="display-i" style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>· Ficha técnica</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }} title="La imagen es el snapshot del diseño al abrir la ficha">
            snapshot del diseño al abrir
          </span>
          <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: 13, padding: '6px 14px' }}>
            🖨 Exportar PDF
          </button>
          <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px' }}>
            Cerrar
          </button>
        </div>
      </div>

      {/* Lienzo del documento A4 */}
      <div className="scroll-hide" style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '28px 0 60px', background: 'var(--surface)' }}>
        <TechPackSheetBody project={project} designer={designer} garmentImg={snapshot} measures={measures} />
      </div>
    </div>
  )
}
