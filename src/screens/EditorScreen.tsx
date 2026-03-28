import { useEffect, useRef, useState } from 'react'
import * as fabric from 'fabric'
import { Project } from '../types/project'
import './EditorScreen.css'

interface Props {
  project: Project
  onBack: () => void
  onSave: (thumbnail: string) => void
}

type Tool = 'select' | 'draw' | 'fill'

export default function EditorScreen({ project, onBack, onSave }: Props) {
  const canvasEl = useRef<HTMLCanvasElement>(null)
  const fc = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const mockupClipPath = useRef<fabric.Group | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ff6b00')
  const [brushSize, setBrushSize] = useState(8)
  const [saved, setSaved] = useState(false)

  // Init canvas
  useEffect(() => {
    if (!canvasEl.current) return
    let cancelled = false

    const canvas = new fabric.Canvas(canvasEl.current, {
      width: 600,
      height: 600,
      backgroundColor: '',        // transparent — prenda sola sobre el fondo del editor
      selection: true,
    })
    fc.current = canvas

    const svgUrl = `/mockups/${project.mockupId}.svg`

    // Load display SVG
    fabric.loadSVGFromURL(svgUrl).then(async ({ objects }) => {
      if (cancelled) return

      const objs = objects.filter(Boolean) as fabric.FabricObject[]
      mockupObjects.current = objs

      objs.forEach(obj => {
        obj.set({ selectable: false, evented: true, hoverCursor: 'crosshair' })
        canvas.add(obj)
      })

      // Compute bounds and scale to fit 500px inside 600px canvas
      const allLeft   = objs.map(o => o.left ?? 0)
      const allTop    = objs.map(o => o.top  ?? 0)
      const allRight  = objs.map(o => (o.left ?? 0) + (o.width  ?? 0) * (o.scaleX ?? 1))
      const allBottom = objs.map(o => (o.top  ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
      const bx = Math.min(...allLeft)
      const by = Math.min(...allTop)
      const bw = Math.max(...allRight)  - bx
      const bh = Math.max(...allBottom) - by
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

      // Build clip path: load SVG again, apply same transform, group with absolutePositioned
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

      // Clip every new drawn path to the mockup shape
      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (mockupClipPath.current) {
          e.path.clipPath = mockupClipPath.current
          canvas.renderAll()
        }
      })

      canvas.renderAll()
    })

    return () => {
      cancelled = true
      canvas.dispose()
    }
  }, [project.mockupId])

  // Sync tool to canvas
  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return

    if (tool === 'draw') {
      canvas.isDrawingMode = true
      const brush = new fabric.PencilBrush(canvas)
      brush.color = color
      brush.width = brushSize
      canvas.freeDrawingBrush = brush
    } else {
      canvas.isDrawingMode = false
    }
  }, [tool, color, brushSize])

  // Sync brush color/size live
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || tool !== 'draw' || !canvas.freeDrawingBrush) return
    canvas.freeDrawingBrush.color = color
    canvas.freeDrawingBrush.width = brushSize
  }, [color, brushSize, tool])

  // Fill tool
  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return

    function handleMouseDown(e: fabric.TPointerEventInfo) {
      if (tool !== 'fill') return
      const target = e.target
      if (target && mockupObjects.current.includes(target)) {
        target.set({ fill: color })
        canvas!.renderAll()
      }
    }

    canvas.on('mouse:down', handleMouseDown)
    return () => { canvas.off('mouse:down', handleMouseDown) }
  }, [tool, color])

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
          <ToolBtn icon="↖" label="Seleccionar" active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Dibujar"     active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="▣" label="Rellenar"    active={tool === 'fill'}   onClick={() => setTool('fill')} />

          <div className="editor-toolbar-divider" />

          <div className="editor-color-wrap" title="Color">
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="editor-color-input" />
            <div className="editor-color-swatch" style={{ background: color }} />
          </div>

          {tool === 'draw' && (
            <div className="editor-brush-wrap">
              <input
                type="range" min={1} max={50} value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="editor-brush-slider"
                title={`Tamaño: ${brushSize}px`}
              />
              <span className="editor-brush-label">{brushSize}</span>
            </div>
          )}
        </aside>

        <main className="editor-canvas-area">
          <canvas ref={canvasEl} />
        </main>
      </div>
    </div>
  )
}

function ToolBtn({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`editor-tool-btn ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      {icon}
    </button>
  )
}
