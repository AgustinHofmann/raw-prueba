import { useEffect, useRef, useState, type RefObject } from 'react'
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

// Pen-nib cursor — tip at (2, 18) in the 20×20 image
const PEN_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cpath d='M2 18 L5 10 L14 1 L19 6 L10 15 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M2 18 L5 10 L10 15 Z' fill='%23aaa'/%3E%3C/svg%3E") 2 18, crosshair`

export default function EditorScreen({ project, onBack, onSave }: Props) {
  const canvasEl      = useRef<HTMLCanvasElement>(null)
  const canvasAreaRef = useRef<HTMLElement>(null)
  const cursorRef     = useRef<HTMLDivElement>(null)
  const fc            = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const clipPath      = useRef<fabric.Group | null>(null)
  const undoHistory   = useRef<HistoryEntry[]>([])
  const colorRef      = useRef('#ff6b00')
  const brushSizeRef  = useRef(8)
  const isMouseDown   = useRef(false)
  const snapPoints    = useRef<fabric.Point[]>([])

  const [tool, setTool]   = useState<Tool>('select')
  const [saved, setSaved] = useState(false)

  // Unified properties — source of truth for drawing defaults AND selected object
  const [hasSel,     setHasSel]     = useState(false)
  const [propFill,   setPropFill]   = useState<string | null>(null)
  const [propStroke, setPropStroke] = useState('#ff6b00')
  const [propSWidth, setPropSWidth] = useState(8)

  useEffect(() => { colorRef.current     = propStroke }, [propStroke])
  useEffect(() => { brushSizeRef.current = propSWidth }, [propSWidth])

  // ── CSS cursor helpers ───────────────────────────────────────────────────────
  function showSizeCursor(clientX: number, clientY: number) {
    const div  = cursorRef.current
    const area = canvasAreaRef.current
    const cv   = canvasEl.current
    if (!div || !area || !cv) return
    const cvRect   = cv.getBoundingClientRect()
    const areaRect = area.getBoundingClientRect()
    const scale = cvRect.width / 600
    const r = (brushSizeRef.current / 2) * scale
    div.style.left    = `${clientX - areaRect.left - r}px`
    div.style.top     = `${clientY - areaRect.top  - r}px`
    div.style.width   = `${r * 2}px`
    div.style.height  = `${r * 2}px`
    div.style.display = 'block'
  }

  // Position cursor at canvas-space coordinates (for snap)
  function showSizeCursorAtCanvasPos(cx: number, cy: number) {
    const div  = cursorRef.current
    const area = canvasAreaRef.current
    const cv   = canvasEl.current
    if (!div || !area || !cv) return
    const cvRect   = cv.getBoundingClientRect()
    const areaRect = area.getBoundingClientRect()
    const scale = cvRect.width / 600
    const r = (brushSizeRef.current / 2) * scale
    const screenX = cx * scale + cvRect.left
    const screenY = cy * scale + cvRect.top
    div.style.left    = `${screenX - areaRect.left - r}px`
    div.style.top     = `${screenY - areaRect.top  - r}px`
    div.style.width   = `${r * 2}px`
    div.style.height  = `${r * 2}px`
    div.style.display = 'block'
  }

  function hideSizeCursor() {
    if (cursorRef.current) cursorRef.current.style.display = 'none'
  }

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

    // ── Illustrator-like selection style ────────────────────────────────────
    // Rubber-band (drag to select): dashed blue border, near-transparent fill
    canvas.selectionColor       = 'rgba(29, 119, 224, 0.06)'
    canvas.selectionBorderColor = '#1D77E0'
    canvas.selectionLineWidth   = 1
    ;(canvas as any).selectionDashArray = [4, 3]
    ;(canvas as any).uniformScaling     = false   // free resize; Shift = proportional

    // Per-object bounding box + handles
    // Illustrator: thin blue outline, small white squares with blue border
    Object.assign(fabric.FabricObject.prototype, {
      borderColor:        '#1D77E0',   // thin blue outline around selected object
      borderScaleFactor:  1,
      cornerColor:        '#ffffff',   // white-filled square handles
      cornerStrokeColor:  '#1D77E0',  // blue border on each handle
      cornerSize:         7,
      cornerStyle:        'rect',
      transparentCorners: false,
      padding:            2,
    })

    // Hide rotation handle — Illustrator triggers rotation by cursor proximity to corners,
    // not via an explicit handle. The mtr dot-on-a-stick looks nothing like Illustrator.
    try {
      fabric.FabricObject.prototype.controls.mtr.visible = false
    } catch (_) { /* controls may not be enumerable in all Fabric builds */ }

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
        e.path.set({ selectable: false, evented: false })
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
    canvas.discardActiveObject()
    canvas.getObjects().forEach(obj => {
      const isMockup = mockupObjects.current.includes(obj)
      obj.set({
        evented:    isMockup ? tool === 'fill' : tool === 'select',
        selectable: isMockup ? false         : tool === 'select',
      })
    })

    const offs: (() => void)[] = []

    // ── Free draw ────────────────────────────────────────────────────────────
    if (tool === 'draw') {
      canvas.isDrawingMode = true
      const brush = new fabric.PencilBrush(canvas)
      brush.color = colorRef.current
      brush.width = brushSizeRef.current
      canvas.freeDrawingBrush = brush
      canvas.defaultCursor = 'none'

      const onMove  = (e: fabric.TPointerEventInfo) => showSizeCursor((e.e as MouseEvent).clientX, (e.e as MouseEvent).clientY)
      const onLeave = () => hideSizeCursor()
      canvas.on('mouse:move', onMove)
      canvasAreaRef.current?.addEventListener('mouseleave', onLeave)
      offs.push(() => {
        canvas.off('mouse:move', onMove)
        canvasAreaRef.current?.removeEventListener('mouseleave', onLeave)
        canvas.defaultCursor = 'default'
        hideSizeCursor()
      })
    }

    // ── Pen / Curve ──────────────────────────────────────────────────────────
    if (tool === 'pen' || tool === 'curve') {
      canvas.selection     = false
      canvas.defaultCursor = PEN_CURSOR
      hideSizeCursor()   // hide brush-circle in case previous tool left it

      const pts: fabric.Point[]   = []
      const dots: fabric.Circle[] = []
      const lines: fabric.Line[]  = []
      let preview: fabric.Line | null = null
      let snapIndicator: fabric.Circle | null = null
      let lastClickTime = 0
      let lastClickPos: fabric.Point | null = null

      const SNAP_RADIUS = 14   // canvas units

      // Returns the nearest snap point and whether it closes the current path
      const findSnap = (p: fabric.Point): { pt: fabric.Point; closes: boolean } | null => {
        // First priority: close the current open path
        if (pts.length >= 2) {
          if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < SNAP_RADIUS)
            return { pt: pts[0], closes: true }
        }
        // Second: snap to any committed path endpoint
        for (const sp of snapPoints.current) {
          if (Math.hypot(p.x - sp.x, p.y - sp.y) < SNAP_RADIUS)
            return { pt: sp, closes: false }
        }
        return null
      }

      const clearSnapIndicator = () => {
        if (snapIndicator) { canvas.remove(snapIndicator); snapIndicator = null }
      }

      const commit = () => {
        if (preview) { canvas.remove(preview); preview = null }
        clearSnapIndicator()
        dots.forEach(d => canvas.remove(d))
        dots.length = 0
        lines.forEach(l => canvas.remove(l))
        lines.length = 0

        if (pts.length >= 2) {
          // Store endpoints for future snapping
          snapPoints.current.push(new fabric.Point(pts[0].x, pts[0].y))
          const lastPt = pts[pts.length - 1]
          if (lastPt.x !== pts[0].x || lastPt.y !== pts[0].y)
            snapPoints.current.push(new fabric.Point(lastPt.x, lastPt.y))

          let obj: fabric.FabricObject

          if (pts.length === 2) {
            // 2-point straight line → rotated Line so the selection box
            // hugs the line (like Illustrator) instead of an axis-aligned square
            const p0 = pts[0], p1 = pts[pts.length - 1]
            const cx    = (p0.x + p1.x) / 2
            const cy    = (p0.y + p1.y) / 2
            const len   = Math.hypot(p1.x - p0.x, p1.y - p0.y)
            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI
            obj = new fabric.Line([-len / 2, 0, len / 2, 0], {
              left: cx, top: cy, angle,
              originX: 'center', originY: 'center',
              stroke: colorRef.current,
              strokeWidth: brushSizeRef.current,
              strokeLineCap: 'round',
              fill: undefined,
              selectable: false, evented: false,
            })
          } else {
            const d = tool === 'curve' ? catmullRomToBezier(pts) : straightPathStr(pts)
            obj = new fabric.Path(d, {
              stroke: colorRef.current,
              strokeWidth: brushSizeRef.current,
              strokeLineCap: 'round',
              strokeLineJoin: 'round',
              fill: null,
              selectable: false, evented: false,
            })
          }

          if (clipPath.current) obj.clipPath = clipPath.current
          canvas.add(obj)
          undoHistory.current.push({ type: 'add', obj })
        }
        pts.length = 0
        canvas.requestRenderAll()
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        const now = Date.now()
        const raw0 = e.scenePoint
        const isDbl = now - lastClickTime < 350
          && lastClickPos !== null
          && Math.hypot(raw0.x - lastClickPos.x, raw0.y - lastClickPos.y) < 10
        lastClickTime = now
        lastClickPos  = raw0
        if (isDbl) { commit(); return }

        const raw = raw0
        const snap = findSnap(raw)

        if (snap?.closes) {
          pts.push(new fabric.Point(pts[0].x, pts[0].y))
          commit()
          return
        }

        const p = snap ? snap.pt : raw

        if (pts.length >= 1) {
          const prev = pts[pts.length - 1]
          const seg = new fabric.Line([prev.x, prev.y, p.x, p.y], {
            stroke: colorRef.current,
            strokeWidth: brushSizeRef.current,
            strokeLineCap: 'round',
            selectable: false, evented: false,
          })
          lines.push(seg)
          canvas.add(seg)
        }

        pts.push(snap ? new fabric.Point(snap.pt.x, snap.pt.y) : p)
        const dot = new fabric.Circle({
          left: p.x - 4, top: p.y - 4, radius: 4,
          fill: colorRef.current, stroke: '#fff', strokeWidth: 1.5,
          selectable: false, evented: false,
        })
        dots.push(dot)
        canvas.add(dot)
        canvas.requestRenderAll()
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        const raw = e.scenePoint
        const snap = findSnap(raw)

        if (snap) {
          // Highlight first dot orange when closing current path
          if (dots[0]) dots[0].set({ stroke: snap.closes ? '#ff6b00' : '#fff', strokeWidth: snap.closes ? 2.5 : 1.5 })
          // Show orange ring at external snap point
          if (!snap.closes) {
            if (!snapIndicator) {
              snapIndicator = new fabric.Circle({
                radius: 7, fill: 'transparent',
                stroke: '#ff6b00', strokeWidth: 1.5,
                selectable: false, evented: false,
                originX: 'center', originY: 'center',
              })
              canvas.add(snapIndicator)
            }
            snapIndicator.set({ left: snap.pt.x, top: snap.pt.y })
          } else {
            clearSnapIndicator()
          }
        } else {
          if (dots[0]) dots[0].set({ stroke: '#fff', strokeWidth: 1.5 })
          clearSnapIndicator()
        }

        if (pts.length === 0) { canvas.requestRenderAll(); return }

        const target = snap ? snap.pt : raw
        if (preview) canvas.remove(preview)
        const last = pts[pts.length - 1]
        preview = new fabric.Line([last.x, last.y, target.x, target.y], {
          stroke: colorRef.current, strokeWidth: 1,
          strokeDashArray: [5, 4], opacity: 0.5,
          selectable: false, evented: false,
        })
        canvas.add(preview)
        canvas.requestRenderAll()
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'Escape') { commit(); return }
      }

      const onLeave = () => hideSizeCursor()

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      window.addEventListener('keydown', onKey)
      canvasAreaRef.current?.addEventListener('mouseleave', onLeave)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        window.removeEventListener('keydown', onKey)
        canvasAreaRef.current?.removeEventListener('mouseleave', onLeave)
        canvas.defaultCursor = 'default'
        if (preview) canvas.remove(preview)
        clearSnapIndicator()
        dots.forEach(d => canvas.remove(d))
        lines.forEach(l => canvas.remove(l))
        canvas.requestRenderAll()
        hideSizeCursor()
      })
    }

    // ── Eraser ───────────────────────────────────────────────────────────────
    if (tool === 'eraser') {
      canvas.selection     = false
      canvas.defaultCursor = 'none'

      const onDown  = () => { isMouseDown.current = true }
      const onUp    = () => { isMouseDown.current = false }

      const onMove = (e: fabric.TPointerEventInfo) => {
        const p = e.scenePoint
        const r = brushSizeRef.current
        showSizeCursor((e.e as MouseEvent).clientX, (e.e as MouseEvent).clientY)

        if (isMouseDown.current) {
          const bounds = { left: p.x - r, top: p.y - r, right: p.x + r, bottom: p.y + r }
          const toRemove = canvas.getObjects().filter(obj => {
            if (mockupObjects.current.includes(obj)) return false
            const b = obj.getBoundingRect()
            return (
              b.left              < bounds.right  &&
              b.left + b.width    > bounds.left   &&
              b.top               < bounds.bottom &&
              b.top  + b.height   > bounds.top
            )
          })
          toRemove.forEach(obj => canvas.remove(obj))
        }
        canvas.requestRenderAll()
      }

      const onLeave = () => hideSizeCursor()

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:up',   onUp)
      canvas.on('mouse:move', onMove)
      canvasAreaRef.current?.addEventListener('mouseleave', onLeave)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:up',   onUp)
        canvas.off('mouse:move', onMove)
        canvasAreaRef.current?.removeEventListener('mouseleave', onLeave)
        canvas.defaultCursor = 'default'
        hideSizeCursor()
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

    // ── Select ───────────────────────────────────────────────────────────────
    if (tool === 'select') {
      const syncProps = (obj: fabric.FabricObject | null) => {
        if (!obj) { setHasSel(false); return }
        setHasSel(true)
        setPropFill(typeof obj.fill   === 'string' ? obj.fill   : null)
        setPropStroke(typeof obj.stroke === 'string' ? obj.stroke : '#000000')
        setPropSWidth(obj.strokeWidth ?? 1)
      }

      const onCreated  = (e: { selected?: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
      const onUpdated  = (e: { selected?: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
      const onCleared  = () => syncProps(null)

      canvas.on('selection:created', onCreated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:cleared', onCleared)

      offs.push(() => {
        canvas.off('selection:created', onCreated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:cleared', onCleared)
        setHasSel(false)
      })
    }

    return () => offs.forEach(fn => fn())
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync brush live
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || tool !== 'draw' || !canvas.freeDrawingBrush) return
    canvas.freeDrawingBrush.color = propStroke
    canvas.freeDrawingBrush.width = propSWidth
  }, [propStroke, propSWidth, tool])

  // ── Property panel handlers ─────────────────────────────────────────────────
  function applyFill(val: string | null) {
    setPropFill(val)
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ fill: val ?? undefined })
      fc.current?.requestRenderAll()
    }
  }

  function applyStroke(val: string) {
    setPropStroke(val)   // also updates colorRef via useEffect
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ stroke: val })
      fc.current?.requestRenderAll()
    }
  }

  function applyStrokeWidth(val: number) {
    const clamped = Math.max(0.5, val)
    setPropSWidth(clamped)   // also updates brushSizeRef via useEffect
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ strokeWidth: clamped })
      fc.current?.requestRenderAll()
    }
  }

  // ── Undo (Ctrl+Z) + Delete selected ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const canvas = fc.current
      if (!canvas) return

      // Delete / Backspace → remove active object
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = canvas.getActiveObject()
        if (active && !mockupObjects.current.includes(active)) {
          e.preventDefault()
          canvas.remove(active)
          canvas.discardActiveObject()
          canvas.requestRenderAll()
          return
        }
      }

      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z') return
      e.preventDefault()
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
        {/* ── Left toolbar ── */}
        <aside className="editor-toolbar">
          <ToolBtn icon="↖" label="Seleccionar"  active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Pincel libre" active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="🖊" label="Pluma"        active={tool === 'pen'}    onClick={() => setTool('pen')} />
          <ToolBtn icon="∿" label="Curvatura"    active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="◻" label="Goma"         active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon="▣" label="Relleno"      active={tool === 'fill'}   onClick={() => setTool('fill')} />
          <div className="editor-toolbar-divider" />
          <div className="editor-hint">Ctrl+Z<br/>undo</div>
        </aside>

        {/* ── Canvas ── */}
        <main className="editor-canvas-area" ref={canvasAreaRef as RefObject<HTMLElement>}>
          <canvas ref={canvasEl} />
          <div ref={cursorRef} className="editor-size-cursor" />
          {(tool === 'pen' || tool === 'curve') && (
            <div className="editor-pen-hint">
              Click · agregar &nbsp;|&nbsp; Doble-click / Enter · terminar &nbsp;|&nbsp; Esc · finalizar
            </div>
          )}
        </main>

        {/* ── Right properties panel — always visible ── */}
        <aside className="editor-props">
          <div className="prop-section">
            <span className="prop-label">Relleno</span>
            <div className="prop-row">
              {propFill !== null ? (
                <>
                  <div className="prop-color-wrap">
                    <input type="color" value={propFill} onChange={e => applyFill(e.target.value)} className="prop-color-input" />
                    <div className="prop-color-swatch" style={{ background: propFill }} />
                  </div>
                  <button className="prop-none-btn" onClick={() => applyFill(null)} title="Sin relleno">✕</button>
                </>
              ) : (
                <button className="prop-add-btn" onClick={() => applyFill('#ffffff')}>+ color</button>
              )}
            </div>
          </div>

          <div className="prop-section">
            <span className="prop-label">Trazado</span>
            <div className="prop-row">
              <div className="prop-color-wrap">
                <input type="color" value={propStroke} onChange={e => applyStroke(e.target.value)} className="prop-color-input" />
                <div className="prop-color-swatch" style={{ background: propStroke }} />
              </div>
            </div>
            <div className="prop-weight-row">
              <span className="prop-weight-label">Grosor</span>
              <div className="prop-weight-input-wrap">
                <input
                  type="number"
                  min={0.5} max={200} step={0.5}
                  value={propSWidth}
                  onChange={e => applyStrokeWidth(Number(e.target.value))}
                  onBlur={e  => applyStrokeWidth(Number(e.target.value))}
                  className="prop-weight-input"
                />
                <span className="prop-weight-unit">px</span>
              </div>
            </div>
          </div>

          {hasSel && (
            <p className="prop-sel-hint">· objeto seleccionado</p>
          )}
        </aside>
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
