import { useRef } from 'react'
import type { Annotation, AnnotationKind, AnnotationCategory } from '../types/project'

export type AnnTool = AnnotationKind | 'select'

interface Props {
  slotId: string
  src: string | null
  alt?: string
  height?: number | string
  annotations: Annotation[]      // ya filtradas para este slot
  tool: AnnTool
  category: AnnotationCategory
  onCreate: (a: Annotation) => void
  onUpdate: (id: string, patch: Partial<Annotation>) => void
  onDelete: (id: string) => void
  nextNumber: () => number
}

const CAT_COLOR: Record<AnnotationCategory, string> = {
  construccion: '#1d4ed8',
  material:     '#6b7a00',
  medida:       '#b91c1c',
}

const uid = () => crypto.randomUUID()
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// Capa de anotaciones ancladas a una imagen. La punta (tip) y la caja (box) viven
// en coordenadas normalizadas (0..1) de la imagen, así sobreviven a reemplazos/escala.
export default function AnnotationLayer({
  slotId, src, alt, height = 200, annotations, tool, category,
  onCreate, onUpdate, onDelete, nextNumber,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  function normFromEvent(e: { clientX: number; clientY: number }) {
    const rect = ref.current!.getBoundingClientRect()
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    }
  }

  // Arrastre genérico: aplica coords normalizadas mientras se mueve el puntero
  function beginDrag(e: React.PointerEvent, apply: (x: number, y: number) => void) {
    e.preventDefault(); e.stopPropagation()
    const move = (ev: PointerEvent) => { const n = normFromEvent(ev); apply(n.x, n.y) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function createAt(e: React.MouseEvent) {
    if (tool === 'select') return
    const n = normFromEvent(e)
    const a: Annotation = {
      id: uid(), slotId, kind: tool, category,
      tipX: n.x, tipY: n.y,
      boxX: clamp01(n.x + 0.14), boxY: clamp01(n.y - 0.06),
      text: tool === 'callout' ? '' : 'NOTA',
      number: tool === 'callout' ? nextNumber() : undefined,
      dashed: false,
    }
    onCreate(a)
  }

  const pct = (v: number) => `${v * 100}%`

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height, userSelect: 'none' }}>
      {src
        ? <img src={src} alt={alt} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#aaa' }}>Sin imagen</div>}

      {/* SVG: líneas guía (no captura el puntero) */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <defs>
          {Object.entries(CAT_COLOR).map(([k, c]) => (
            <marker key={k} id={`arrow-${slotId}-${k}`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L7,3 L0,6 Z" fill={c} />
            </marker>
          ))}
        </defs>
        {annotations.map(a => {
          const c = CAT_COLOR[a.category]
          const showArrow = a.kind === 'arrow'
          return (
            <line
              key={a.id}
              x1={pct(a.boxX)} y1={pct(a.boxY)} x2={pct(a.tipX)} y2={pct(a.tipY)}
              stroke={c} strokeWidth={1.5}
              strokeDasharray={a.dashed ? '4 3' : undefined}
              markerEnd={showArrow ? `url(#arrow-${slotId}-${a.category})` : undefined}
            />
          )
        })}
      </svg>

      {/* Puntas ancladas + burbujas + callouts numerados */}
      {annotations.map(a => {
        const c = CAT_COLOR[a.category]
        return (
          <div key={'tip-' + a.id}>
            {/* Punta (arrastrable para re-anclar la zona) */}
            <div
              onPointerDown={e => beginDrag(e, (x, y) => onUpdate(a.id, { tipX: x, tipY: y }))}
              title="Arrastrá para re-anclar"
              style={{
                position: 'absolute', left: pct(a.tipX), top: pct(a.tipY), transform: 'translate(-50%,-50%)',
                width: a.kind === 'callout' ? 18 : a.kind === 'bubble' ? 26 : 10,
                height: a.kind === 'callout' ? 18 : a.kind === 'bubble' ? 26 : 10,
                borderRadius: '50%', cursor: 'grab', zIndex: 3,
                background: a.kind === 'callout' ? c : 'transparent',
                border: `2px ${a.dashed ? 'dashed' : 'solid'} ${c}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 10, fontWeight: 700,
              }}
            >
              {a.kind === 'callout' ? a.number : ''}
            </div>
          </div>
        )
      })}

      {/* Cajas de texto (arrastrables + editables) */}
      {annotations.map(a => {
        const c = CAT_COLOR[a.category]
        return (
          <div
            key={'box-' + a.id}
            style={{
              position: 'absolute', left: pct(a.boxX), top: pct(a.boxY),
              transform: 'translate(-50%,-50%)', zIndex: 4,
              minWidth: 70, maxWidth: 150,
              background: '#fff', border: `1.5px solid ${c}`, borderRadius: 4,
              boxShadow: '0 1px 4px rgb(0 0 0 / 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', background: c, height: 14 }}>
              <span
                onPointerDown={e => beginDrag(e, (x, y) => onUpdate(a.id, { boxX: x, boxY: y }))}
                title="Mover nota"
                style={{ flex: 1, cursor: 'grab', color: '#fff', fontSize: 8, paddingLeft: 4, lineHeight: '14px' }}
              >⠿ {a.kind === 'callout' && a.number ? `#${a.number}` : ''}</span>
              <button
                className="no-print"
                onClick={() => onUpdate(a.id, { dashed: !a.dashed })}
                title="Línea sólida / punteada"
                style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 9, cursor: 'pointer', padding: '0 3px' }}
              >{a.dashed ? '⋯' : '—'}</button>
              <button
                className="no-print"
                onClick={() => onDelete(a.id)}
                title="Eliminar"
                style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 9, cursor: 'pointer', padding: '0 4px' }}
              >✕</button>
            </div>
            <textarea
              value={a.text}
              onChange={e => onUpdate(a.id, { text: e.target.value })}
              rows={2}
              style={{
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                fontSize: 9, fontFamily: 'Arial', padding: '3px 4px', color: '#111',
                background: 'transparent', boxSizing: 'border-box', textTransform: 'uppercase',
              }}
            />
          </div>
        )
      })}

      {/* Captura de clicks para crear (solo con herramienta activa) */}
      {tool !== 'select' && (
        <div
          onClick={createAt}
          title="Click para colocar la anotación"
          style={{ position: 'absolute', inset: 0, zIndex: 2, cursor: 'crosshair' }}
        />
      )}
    </div>
  )
}
