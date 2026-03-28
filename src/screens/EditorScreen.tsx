import { useEffect, useRef, useState } from 'react'
import * as fabric from 'fabric'
import { Project } from '../types/project'
import './EditorScreen.css'

interface Props {
  project: Project
  onBack: () => void
  onSave: (thumbnail: string) => void
}

type Tool = 'select' | 'draw' | 'pen' | 'curve' | 'eraser' | 'fill'

type HistoryEntry =
  | { type: 'add';  obj: fabric.FabricObject }
  | { type: 'fill'; obj: fabric.FabricObject; prevFill: fabric.TFiller | string | null }

// ── Catmull-Rom spline → SVG cubic bezier ───────────────────────────────────
function catmullRomToBezier(pts: fabric.Point[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`
  }
  return d
}

function straightPathStr(pts: fabric.Point[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export default function EditorScreen({ project, onBack, onSave }: Props) {
  const canvasEl       = useRef<HTMLCanvasElement>(null)
  const fc             = useRef<fabric.Canvas | null>(null)
  const mockupObjects  = useRef<fabric.FabricObject[]>([])
  const clipPath       = useRef<fabric.Group | null>(null)
  const undoHistory    = useRef<HistoryEntry[]>([])
  const colorRef       = useRef('#ff6b00')
  const brushSizeRef   = useRef(8)
  const isMouseDown    = useRef(false)

  const [tool, setTool]           = useState<Tool>('select')
  const [color, setColor]         = useState('#ff6b00')
  const [brushSize, setBrushSize] = useState(8)
  const [saved, setSaved]         = useState(false)

  useEffect(() => { colorRef.current    = color     }, [color])
  useEffect(() => { brushSizeRef.current = brushSize }, [brushSize])

  // ── Init canvas ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasEl.current) return
    let cancelled = false

    const canvas = new fabric.Canvas(canvasEl.current, {
      width: 600, height: 600,
      backgroundColor: '',
      selection: true,
    })
    fc.current = canvas

    const svgUrl = `/mockups/${project.mockupId}.svg`

    fabric.loadSVGFromURL(svgUrl).then(async ({ objects }) => {
      if (cancelled) return
      const objs = objects.filter(Boolean) as fabric.FabricObject[]
      mockupObjects.current = objs

      objs.forEach(obj => {
        obj.set({ selectable: false, evented: true, hoverCursor: 'crosshair' })
        canvas.add(obj)
      })

      // Compute scale / offset
      const allL = objs.map(o => o.left ?? 0)
      const allT = objs.map(o => o.top  ?? 0)
      const allR = objs.map(o => (o.left ?? 0) + (o.width  ?? 0) * (o.scaleX ?? 1))
      const allB = objs.map(o => (o.top  ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
      const bx = Math.min(...allL), by = Math.min(...allT)
      const bw = Math.max(...allR) - bx, bh = Math.max(...allB) - by
      const sc = Math.min(500 / bw, 500 / bh)
      const ox = (600 - bw * sc) / 2 - bx * sc
      const oy = (600 - bh * sc) / 2 - by * sc

      objs.forEach(obj => obj.set({
        left:   (obj.left   ?? 0) * sc + ox,
        top:    (obj.top    ?? 0) * sc + oy,
        scaleX: (obj.scaleX ?? 1) * sc,
        scaleY: (obj.scaleY ?? 1) * sc,
      }))

      // Build clip path (second SVG load, same transform)
      const { objects: clipRaw } = await fabric.loadSVGFromURL(svgUrl)
      if (cancelled) return
      const clipObjs = (clipRaw.filter(Boolean) as fabric.FabricObject[]).map(obj => {
        obj.set({
          left:   (obj.left   ?? 0) * sc + ox,
          top:    (obj.top    ?? 0) * sc + oy,
          scaleX: (obj.scaleX ?? 1) * sc,
          scaleY: (obj.scaleY ?? 1) * sc,
        })
        return obj
      })
      const cg = new fabric.Group(clipObjs)
      cg.absolutePositioned = true
      clipPath.current = cg

      // Track free-draw paths in undo history
      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (clipPath.current) e.path.clipPath = clipPath.current
        undoHistory.current.push({ type: 'add', obj: e.path })
        canvas.renderAll()
      })

      canvas.renderAll()
    })

    return () => { cancelled = true; canvas.dispose() }
  }, [project.mockupId])

  // ── Tool switching ─────────────────────────────────────────────────────────
  useEffect(() => {
    const _c = fc.current
    if (!_c) return
    const canvas: fabric.Canvas = _c

    canvas.isDrawingMode = false
    canvas.selection     = tool === 'select'
    mockupObjects.current.forEach(obj =>
      obj.set({ evented: tool === 'fill', selectable: false })
    )

    const offs: (() => void)[] = []

    if (tool === 'draw') {
      canvas.isDrawingMode = true
      const brush = new fabric.PencilBrush(canvas)
      brush.color = colorRef.current
      brush.width = brushSizeRef.current
      canvas.freeDrawingBrush = brush
    }

    // ── Pen / Curve ──────────────────────────────────────────────────────────
    if (tool === 'pen' || tool === 'curve') {
      canvas.selection = false
      const pts: fabric.Point[] = []
      const dots: fabric.Circle[] = []
      let preview: fabric.Line | null = null
      let skipNext = false    // suppress mousedown that belongs to dblclick

      const commit = () => {
        if (preview) { canvas.remove(preview); preview = null }
        dots.forEach(d => canvas.remove(d))
        dots.length = 0

        if (pts.length >= 2) {
          const d   = tool === 'curve' ? catmullRomToBezier(pts) : straightPathStr(pts)
          const path = new fabric.Path(d, {
            stroke: colorRef.current,
            strokeWidth: brushSizeRef.current,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            fill: null,
            selectable: true,
          })
          if (clipPath.current) path.clipPath = clipPath.current
          canvas.add(path)
          undoHistory.current.push({ type: 'add', obj: path })
        }
        pts.length = 0
        canvas.requestRenderAll()
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        if (pts.length === 0) return
        const p = e.scenePoint
        if (preview) canvas.remove(preview)
        const last = pts[pts.length - 1]
        preview = new fabric.Line([last.x, last.y, p.x, p.y], {
          stroke: colorRef.current, strokeWidth: 1,
          strokeDashArray: [5, 4], opacity: 0.5,
          selectable: false, evented: false,
        })
        canvas.add(preview)
        canvas.bringObjectToFront(preview)
        canvas.requestRenderAll()
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        if (skipNext) return
        const p = e.scenePoint
        pts.push(p)
        const dot = new fabric.Circle({
          left: p.x - 4, top: p.y - 4, radius: 4,
          fill: colorRef.current, stroke: '#fff', strokeWidth: 1.5,
          selectable: false, evented: false,
        })
        dots.push(dot)
        canvas.add(dot)
        canvas.bringObjectToFront(dot)
        canvas.requestRenderAll()
      }

      const onDbl = () => {
        skipNext = true
        // Remove the point added by the 2nd mousedown of the dblclick
        pts.pop()
        const d = dots.pop()
        if (d) canvas.remove(d)
        commit()
        setTimeout(() => { skipNext = false }, 300)
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') { commit(); return }
        if (e.key === 'Escape') {
          if (preview) canvas.remove(preview)
          dots.forEach(d => canvas.remove(d))
          dots.length = 0; pts.length = 0
          canvas.requestRenderAll()
        }
      }

      canvas.on('mouse:move',     onMove)
      canvas.on('mouse:down',     onDown)
      canvas.on('mouse:dblclick', onDbl)
      window.addEventListener('keydown', onKey)

      offs.push(() => {
        canvas.off('mouse:move',     onMove)
        canvas.off('mouse:down',     onDown)
        canvas.off('mouse:dblclick', onDbl)
        window.removeEventListener('keydown', onKey)
        if (preview) canvas.remove(preview)
        dots.forEach(d => canvas.remove(d))
        canvas.requestRenderAll()
      })
    }

    // ── Eraser ───────────────────────────────────────────────────────────────
    if (tool === 'eraser') {
      canvas.selection = false
      const onDown = () => { isMouseDown.current = true }
      const onUp   = () => { isMouseDown.current = false }
      const onMove = (e: fabric.TPointerEventInfo) => {
        if (!isMouseDown.current) return
        const target = canvas.findTarget(e.e)
        if (target && !mockupObjects.current.includes(target)) {
          canvas.remove(target)
          canvas.requestRenderAll()
        }
      }
      canvas.on('mouse:down', onDown)
      canvas.on('mouse:up',   onUp)
      canvas.on('mouse:move', onMove)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:up',   onUp)
        canvas.off('mouse:move', onMove)
      })
    }

    // ── Fill ─────────────────────────────────────────────────────────────────
    if (tool === 'fill') {
      const onDown = (e: fabric.TPointerEventInfo) => {
        const target = e.target
        if (target && mockupObjects.current.includes(target)) {
          const prevFill = target.fill
          target.set({ fill: colorRef.current })
          undoHistory.current.push({ type: 'fill', obj: target, prevFill: prevFill as fabric.TFiller | string | null })
          canvas.requestRenderAll()
        }
      }
      canvas.on('mouse:down', onDown)
      offs.push(() => canvas.off('mouse:down', onDown))
    }

    return () => offs.forEach(fn => fn())
  }, [tool])

  // Sync brush live
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || tool !== 'draw' || !canvas.freeDrawingBrush) return
    canvas.freeDrawingBrush.color = color
    canvas.freeDrawingBrush.width = brushSize
  }, [color, brushSize, tool])

  // ── Undo (Ctrl+Z) — handles both drawn objects and fill changes ────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z') return
      e.preventDefault()
      const canvas = fc.current
      if (!canvas) return
      const entry = undoHistory.current.pop()
      if (!entry) return
      if (entry.type === 'add') {
        canvas.remove(entry.obj)
      } else {
        entry.obj.set({ fill: entry.prevFill as string })
      }
      canvas.requestRenderAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleSave() {
    const canvas = fc.current
    if (!canvas) return
    onSave(canvas.toDataURL({ format: 'png', multiplier: 0.3 }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleExport() {
    const canvas = fc.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL({ format: 'png', multiplier: 2 })
    a.download = `${project.name}.png`
    a.click()
  }

  return (
    <div className="editor">
      <header className="editor-topbar">
        <button className="editor-back" onClick={onBack}>← RAW</button>
        <span className="editor-project-name">{project.name}</span>
        <div className="editor-topbar-actions">
          <button className="editor-btn-save" onClick={handleSave}>
            {saved ? '✓ Guardado' : 'Guardar'}
          </button>
          <button className="editor-btn-export" onClick={handleExport}>Exportar PNG</button>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-toolbar">
          <ToolBtn icon="↖" label="Seleccionar"    active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Pincel libre"   active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="🖊" label="Pluma"          active={tool === 'pen'}    onClick={() => setTool('pen')} />
          <ToolBtn icon="∿" label="Curvatura"      active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="◻" label="Goma"           active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon="▣" label="Relleno"        active={tool === 'fill'}   onClick={() => setTool('fill')} />

          <div className="editor-toolbar-divider" />

          <div className="editor-color-wrap" title="Color activo">
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="editor-color-input" />
            <div className="editor-color-swatch" style={{ background: color }} />
          </div>

          {(tool === 'draw' || tool === 'pen' || tool === 'curve') && (
            <div className="editor-brush-wrap">
              <input
                type="range" min={1} max={50} value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="editor-brush-slider"
                title={`Grosor: ${brushSize}px`}
              />
              <span className="editor-brush-label">{brushSize}</span>
            </div>
          )}

          <div className="editor-toolbar-divider" />
          <div className="editor-hint">Ctrl+Z<br/>undo</div>
        </aside>

        <main className="editor-canvas-area">
          <canvas ref={canvasEl} />
          {(tool === 'pen' || tool === 'curve') && (
            <div className="editor-pen-hint">
              Click · agregar punto &nbsp;|&nbsp; Doble-click / Enter · terminar &nbsp;|&nbsp; Esc · cancelar
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function ToolBtn({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button className={`editor-tool-btn ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      {icon}
    </button>
  )
}
