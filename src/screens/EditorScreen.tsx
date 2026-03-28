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

// ── Catmull-Rom → SVG cubic bezier ──────────────────────────────────────────
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
  const canvasEl      = useRef<HTMLCanvasElement>(null)
  const fc            = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const clipPath      = useRef<fabric.Group | null>(null)
  const undoHistory   = useRef<HistoryEntry[]>([])
  const colorRef      = useRef('#ff6b00')
  const brushSizeRef  = useRef(8)
  const isMouseDown   = useRef(false)

  const [tool, setTool]           = useState<Tool>('select')
  const [color, setColor]         = useState('#ff6b00')
  const [brushSize, setBrushSize] = useState(8)
  const [saved, setSaved]         = useState(false)

  useEffect(() => { colorRef.current     = color     }, [color])
  useEffect(() => { brushSizeRef.current = brushSize }, [brushSize])

  // ── Canvas init ─────────────────────────────────────────────────────────────
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

      objs.forEach(obj => obj.set({ selectable: false, evented: true, hoverCursor: 'crosshair' }))
      objs.forEach(obj => canvas.add(obj))

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

      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (clipPath.current) e.path.clipPath = clipPath.current
        undoHistory.current.push({ type: 'add', obj: e.path })
        canvas.renderAll()
      })

      canvas.renderAll()
    })

    return () => { cancelled = true; canvas.dispose() }
  }, [project.mockupId])

  // ── Tool switching ──────────────────────────────────────────────────────────
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

    // ── Free draw ────────────────────────────────────────────────────────────
    if (tool === 'draw') {
      canvas.isDrawingMode = true
      const brush = new fabric.PencilBrush(canvas)
      brush.color = colorRef.current
      brush.width = brushSizeRef.current
      canvas.freeDrawingBrush = brush

      // Brush preview cursor
      canvas.defaultCursor = 'none'
      const cur = new fabric.Circle({
        radius: brushSizeRef.current / 2,
        fill: 'transparent',
        stroke: 'rgba(255,255,255,0.7)',
        strokeWidth: 1,
        strokeDashArray: [3, 3],
        selectable: false, evented: false,
        originX: 'center', originY: 'center',
        left: -200, top: -200,
      })
      canvas.add(cur)

      const onMove = (e: fabric.TPointerEventInfo) => {
        const p = e.scenePoint
        cur.set({ left: p.x, top: p.y, radius: brushSizeRef.current / 2 })
        canvas.bringObjectToFront(cur)
        canvas.requestRenderAll()
      }
      canvas.on('mouse:move', onMove)

      offs.push(() => {
        canvas.off('mouse:move', onMove)
        canvas.remove(cur)
        canvas.defaultCursor = 'default'
        canvas.requestRenderAll()
      })
    }

    // ── Pen / Curve ──────────────────────────────────────────────────────────
    if (tool === 'pen' || tool === 'curve') {
      canvas.selection = false
      canvas.defaultCursor = 'none'

      // Stroke-width preview cursor
      const cur = new fabric.Circle({
        radius: brushSizeRef.current / 2,
        fill: 'transparent',
        stroke: 'rgba(255,255,255,0.7)',
        strokeWidth: 1,
        strokeDashArray: [3, 3],
        selectable: false, evented: false,
        originX: 'center', originY: 'center',
        left: -200, top: -200,
      })
      canvas.add(cur)

      const pts: fabric.Point[]   = []
      const dots: fabric.Circle[] = []
      let preview: fabric.Line | null = null
      let lastClickTime = 0

      const commit = () => {
        if (preview) { canvas.remove(preview); preview = null }
        dots.forEach(d => canvas.remove(d))
        dots.length = 0

        if (pts.length >= 2) {
          const d = tool === 'curve' ? catmullRomToBezier(pts) : straightPathStr(pts)
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

      const onDown = (e: fabric.TPointerEventInfo) => {
        const now = Date.now()
        const isDbl = now - lastClickTime < 350
        lastClickTime = now

        if (isDbl) {
          // Double-click: finish path without adding this point
          commit()
          return
        }

        const p = e.scenePoint

        // Close path if clicking near first dot
        if (pts.length >= 2) {
          const first = pts[0]
          if (Math.hypot(p.x - first.x, p.y - first.y) < 12) {
            pts.push(new fabric.Point(first.x, first.y))
            commit()
            return
          }
        }

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

      const onMove = (e: fabric.TPointerEventInfo) => {
        const p = e.scenePoint

        // Update cursor preview
        cur.set({ left: p.x, top: p.y, radius: Math.max(brushSizeRef.current / 2, 4) })
        canvas.bringObjectToFront(cur)

        if (pts.length === 0) { canvas.requestRenderAll(); return }
        if (preview) canvas.remove(preview)
        const last = pts[pts.length - 1]
        preview = new fabric.Line([last.x, last.y, p.x, p.y], {
          stroke: colorRef.current, strokeWidth: 1,
          strokeDashArray: [5, 4], opacity: 0.5,
          selectable: false, evented: false,
        })
        canvas.add(preview)
        canvas.bringObjectToFront(cur)
        canvas.requestRenderAll()
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') { commit(); return }
        if (e.key === 'Escape') {
          if (preview) { canvas.remove(preview); preview = null }
          dots.forEach(d => canvas.remove(d))
          dots.length = 0; pts.length = 0
          canvas.requestRenderAll()
        }
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      window.addEventListener('keydown', onKey)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        window.removeEventListener('keydown', onKey)
        canvas.defaultCursor = 'default'
        canvas.remove(cur)
        if (preview) canvas.remove(preview)
        dots.forEach(d => canvas.remove(d))
        canvas.requestRenderAll()
      })
    }

    // ── Eraser ───────────────────────────────────────────────────────────────
    if (tool === 'eraser') {
      canvas.selection = false
      canvas.defaultCursor = 'none'

      // Visual eraser cursor
      const cursor = new fabric.Circle({
        radius: brushSizeRef.current,
        fill: 'rgba(255,255,255,0.08)',
        stroke: 'rgba(255,255,255,0.6)',
        strokeWidth: 1,
        strokeDashArray: [3, 3],
        selectable: false, evented: false,
        originX: 'center', originY: 'center',
        left: -100, top: -100,
      })
      canvas.add(cursor)

      const onDown = () => { isMouseDown.current = true }
      const onUp   = () => { isMouseDown.current = false }

      const onMove = (e: fabric.TPointerEventInfo) => {
        const p = e.scenePoint
        const r = brushSizeRef.current

        // Move visual cursor
        cursor.set({ left: p.x, top: p.y, radius: r })
        canvas.bringObjectToFront(cursor)

        if (isMouseDown.current) {
          const bounds = { left: p.x - r, top: p.y - r, right: p.x + r, bottom: p.y + r }
          const toRemove = canvas.getObjects().filter(obj => {
            if (mockupObjects.current.includes(obj)) return false
            if (obj === cursor) return false
            const b = obj.getBoundingRect()
            return (
              b.left   < bounds.right  &&
              b.left + b.width  > bounds.left &&
              b.top    < bounds.bottom &&
              b.top  + b.height > bounds.top
            )
          })
          toRemove.forEach(obj => canvas.remove(obj))
        }

        canvas.requestRenderAll()
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:up',   onUp)
      canvas.on('mouse:move', onMove)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:up',   onUp)
        canvas.off('mouse:move', onMove)
        canvas.remove(cursor)
        canvas.defaultCursor = 'default'
        canvas.requestRenderAll()
      })
    }

    // ── Fill ─────────────────────────────────────────────────────────────────
    if (tool === 'fill') {
      const onDown = (e: fabric.TPointerEventInfo) => {
        const target = e.target
        if (target && mockupObjects.current.includes(target)) {
          const prevFill = target.fill as fabric.TFiller | string | null
          target.set({ fill: colorRef.current })
          undoHistory.current.push({ type: 'fill', obj: target, prevFill })
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

  // ── Undo (Ctrl+Z) ───────────────────────────────────────────────────────────
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

  const showSizeSlider = tool === 'draw' || tool === 'pen' || tool === 'curve' || tool === 'eraser'

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
          <ToolBtn icon="↖" label="Seleccionar"  active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Pincel libre" active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="🖊" label="Pluma"        active={tool === 'pen'}    onClick={() => setTool('pen')} />
          <ToolBtn icon="∿" label="Curvatura"    active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="◻" label="Goma"         active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon="▣" label="Relleno"      active={tool === 'fill'}   onClick={() => setTool('fill')} />

          <div className="editor-toolbar-divider" />

          {tool !== 'eraser' && (
            <div className="editor-color-wrap" title="Color activo">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="editor-color-input" />
              <div className="editor-color-swatch" style={{ background: color }} />
            </div>
          )}

          {showSizeSlider && (
            <div className="editor-brush-wrap">
              <input
                type="range" min={1} max={80} value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="editor-brush-slider"
                title={tool === 'eraser' ? `Radio: ${brushSize}px` : `Grosor: ${brushSize}px`}
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
              Click · agregar &nbsp;|&nbsp; Doble-click / Enter · terminar &nbsp;|&nbsp; Esc · cancelar
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
