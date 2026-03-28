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

// ── Catmull-Rom → SVG cubic bezier ──────────────────────────────────────────
function catmullRomToBezier(pts: { x: number; y: number }[]): string {
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

function straightPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export default function EditorScreen({ project, onBack, onSave }: Props) {
  const canvasEl        = useRef<HTMLCanvasElement>(null)
  const fc              = useRef<fabric.Canvas | null>(null)
  const mockupObjects   = useRef<fabric.FabricObject[]>([])
  const mockupClipPath  = useRef<fabric.Group | null>(null)
  const colorRef        = useRef('#ff6b00')
  const brushSizeRef    = useRef(8)
  const isMouseDownRef  = useRef(false)

  const [tool, setTool]           = useState<Tool>('select')
  const [color, setColor]         = useState('#ff6b00')
  const [brushSize, setBrushSize] = useState(8)
  const [saved, setSaved]         = useState(false)

  // Keep refs in sync with state (so event handler closures can read current values)
  useEffect(() => { colorRef.current    = color    }, [color])
  useEffect(() => { brushSizeRef.current = brushSize }, [brushSize])

  // ── Init canvas ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasEl.current) return
    let cancelled = false

    const canvas = new fabric.Canvas(canvasEl.current, {
      width: 600,
      height: 600,
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

      const allLeft   = objs.map(o => o.left ?? 0)
      const allTop    = objs.map(o => o.top  ?? 0)
      const allRight  = objs.map(o => (o.left ?? 0) + (o.width  ?? 0) * (o.scaleX ?? 1))
      const allBottom = objs.map(o => (o.top  ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
      const bx = Math.min(...allLeft);  const by = Math.min(...allTop)
      const bw = Math.max(...allRight) - bx;  const bh = Math.max(...allBottom) - by
      const scale   = Math.min(500 / bw, 500 / bh)
      const offsetX = (600 - bw * scale) / 2 - bx * scale
      const offsetY = (600 - bh * scale) / 2 - by * scale

      objs.forEach(obj => {
        obj.set({
          left:   (obj.left   ?? 0) * scale + offsetX,
          top:    (obj.top    ?? 0) * scale + offsetY,
          scaleX: (obj.scaleX ?? 1) * scale,
          scaleY: (obj.scaleY ?? 1) * scale,
        })
      })

      // Build clip path
      const { objects: clipRaw } = await fabric.loadSVGFromURL(svgUrl)
      if (cancelled) return
      const clipObjs = clipRaw.filter(Boolean) as fabric.FabricObject[]
      clipObjs.forEach(obj => {
        obj.set({
          left:   (obj.left   ?? 0) * scale + offsetX,
          top:    (obj.top    ?? 0) * scale + offsetY,
          scaleX: (obj.scaleX ?? 1) * scale,
          scaleY: (obj.scaleY ?? 1) * scale,
        })
      })
      const clipGroup = new fabric.Group(clipObjs)
      clipGroup.absolutePositioned = true
      mockupClipPath.current = clipGroup

      // Clip free-draw paths
      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (mockupClipPath.current) {
          e.path.clipPath = mockupClipPath.current
        }
        canvas.renderAll()
      })

      canvas.renderAll()
    })

    return () => { cancelled = true; canvas.dispose() }
  }, [project.mockupId])

  // ── Tool logic ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const _c = fc.current
    if (!_c) return
    const canvas: fabric.Canvas = _c   // narrowed non-null for closures

    // Reset canvas state
    canvas.isDrawingMode = false
    canvas.selection = tool === 'select'
    mockupObjects.current.forEach(obj => obj.set({ evented: tool === 'fill', selectable: false }))

    const cleanups: (() => void)[] = []

    // ── Free draw ──
    if (tool === 'draw') {
      canvas.isDrawingMode = true
      const brush = new fabric.PencilBrush(canvas)
      brush.color = colorRef.current
      brush.width = brushSizeRef.current
      canvas.freeDrawingBrush = brush
    }

    // ── Pen / Curve ──
    if (tool === 'pen' || tool === 'curve') {
      canvas.selection = false
      const pts: { x: number; y: number }[] = []
      const dots: fabric.Circle[] = []
      let previewLine: fabric.Path | fabric.Line | null = null
      let isDblClick = false

      function finalize() {
        if (previewLine) { canvas.remove(previewLine); previewLine = null }
        dots.forEach(d => canvas.remove(d))
        dots.length = 0

        if (pts.length >= 2) {
          const d = tool === 'curve' ? catmullRomToBezier(pts) : straightPath(pts)
          const path = new fabric.Path(d, {
            stroke: colorRef.current,
            strokeWidth: brushSizeRef.current,
            fill: '',
            selectable: true,
            evented: true,
          })
          if (mockupClipPath.current) path.clipPath = mockupClipPath.current
          canvas.add(path)
        }
        pts.length = 0
        canvas.renderAll()
      }

      function onMouseMove(e: fabric.TPointerEventInfo) {
        if (pts.length === 0) return
        const p = canvas.getPointer(e.e)
        if (previewLine) canvas.remove(previewLine)
        const last = pts[pts.length - 1]
        const preview = new fabric.Line([last.x, last.y, p.x, p.y], {
          stroke: colorRef.current,
          strokeWidth: 1,
          strokeDashArray: [5, 4],
          selectable: false,
          evented: false,
          opacity: 0.6,
        })
        previewLine = preview
        canvas.add(preview)
        canvas.bringObjectToFront(preview)
        canvas.renderAll()
      }

      function onMouseDown(e: fabric.TPointerEventInfo) {
        if (isDblClick) return
        const p = canvas.getPointer(e.e)
        pts.push(p)
        const dot = new fabric.Circle({
          left: p.x - 4, top: p.y - 4, radius: 4,
          fill: colorRef.current, stroke: '#fff', strokeWidth: 1,
          selectable: false, evented: false,
        })
        dots.push(dot)
        canvas.add(dot)
        canvas.bringObjectToFront(dot)
        canvas.renderAll()
      }

      function onDblClick() {
        isDblClick = true
        // Remove last point — it was added by the 2nd mousedown of the dblclick
        pts.pop()
        const lastDot = dots.pop()
        if (lastDot) canvas.remove(lastDot)
        finalize()
        setTimeout(() => { isDblClick = false }, 300)
      }

      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
          if (previewLine) canvas.remove(previewLine)
          dots.forEach(d => canvas.remove(d))
          dots.length = 0; pts.length = 0
          canvas.renderAll()
        }
        if (e.key === 'Enter') finalize()
      }

      canvas.on('mouse:move', onMouseMove)
      canvas.on('mouse:down', onMouseDown)
      canvas.on('mouse:dblclick', onDblClick)
      window.addEventListener('keydown', onKeyDown)

      cleanups.push(() => {
        canvas.off('mouse:move', onMouseMove)
        canvas.off('mouse:down', onMouseDown)
        canvas.off('mouse:dblclick', onDblClick)
        window.removeEventListener('keydown', onKeyDown)
        if (previewLine) canvas.remove(previewLine)
        dots.forEach(d => canvas.remove(d))
        canvas.renderAll()
      })
    }

    // ── Eraser ──
    if (tool === 'eraser') {
      canvas.selection = false

      function onMouseDown() { isMouseDownRef.current = true }
      function onMouseUp()   { isMouseDownRef.current = false }

      function onMouseMove(e: fabric.TPointerEventInfo) {
        if (!isMouseDownRef.current) return
        const p = canvas.getPointer(e.e)
        const toRemove = canvas.getObjects().filter(obj =>
          !mockupObjects.current.includes(obj) && obj.containsPoint(p)
        )
        toRemove.forEach(obj => canvas.remove(obj))
        if (toRemove.length) canvas.renderAll()
      }

      canvas.on('mouse:down', onMouseDown)
      canvas.on('mouse:up',   onMouseUp)
      canvas.on('mouse:move', onMouseMove)

      cleanups.push(() => {
        canvas.off('mouse:down', onMouseDown)
        canvas.off('mouse:up',   onMouseUp)
        canvas.off('mouse:move', onMouseMove)
      })
    }

    // ── Fill ──
    if (tool === 'fill') {
      function onMouseDown(e: fabric.TPointerEventInfo) {
        const target = e.target
        if (target && mockupObjects.current.includes(target)) {
          target.set({ fill: colorRef.current })
          canvas.renderAll()
        }
      }
      canvas.on('mouse:down', onMouseDown)
      cleanups.push(() => canvas.off('mouse:down', onMouseDown))
    }

    return () => cleanups.forEach(fn => fn())
  }, [tool])

  // ── Sync brush color/size live ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || tool !== 'draw' || !canvas.freeDrawingBrush) return
    canvas.freeDrawingBrush.color = color
    canvas.freeDrawingBrush.width = brushSize
  }, [color, brushSize, tool])

  // ── Undo (Ctrl+Z) ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        const canvas = fc.current
        if (!canvas) return
        const objs = canvas.getObjects()
        // Remove last non-mockup object
        for (let i = objs.length - 1; i >= 0; i--) {
          if (!mockupObjects.current.includes(objs[i])) {
            canvas.remove(objs[i])
            canvas.renderAll()
            break
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleSave() {
    const canvas = fc.current
    if (!canvas) return
    const thumbnail = canvas.toDataURL({ format: 'png', multiplier: 0.3 })
    onSave(thumbnail)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleExport() {
    const canvas = fc.current
    if (!canvas) return
    const url = canvas.toDataURL({ format: 'png', multiplier: 2 })
    const a = document.createElement('a')
    a.href = url
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
          <button className="editor-btn-export" onClick={handleExport}>
            Exportar PNG
          </button>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-toolbar">
          <ToolBtn icon="↖"  label="Seleccionar (V)"   active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏"  label="Pincel libre (B)"  active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="🖊"  label="Pluma (P)"         active={tool === 'pen'}    onClick={() => setTool('pen')} />
          <ToolBtn icon="∿"  label="Curvatura (C)"     active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="◻"  label="Goma (E)"          active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon="▣"  label="Relleno (F)"       active={tool === 'fill'}   onClick={() => setTool('fill')} />

          <div className="editor-toolbar-divider" />

          <div className="editor-color-wrap" title="Color">
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
              Click para agregar puntos · Doble click o Enter para terminar · Esc para cancelar
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
