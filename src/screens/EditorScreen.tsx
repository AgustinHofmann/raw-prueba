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

  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ff6b00')
  const [brushSize, setBrushSize] = useState(8)
  const [saved, setSaved] = useState(false)

  // Init canvas
  useEffect(() => {
    if (!canvasEl.current) return
    const canvas = new fabric.Canvas(canvasEl.current, {
      width: 600,
      height: 600,
      backgroundColor: '#2a2a2a',
      selection: true,
    })
    fc.current = canvas

    // Load SVG mockup
    fabric.loadSVGFromURL(`/mockups/${project.mockupId}.svg`).then(({ objects }) => {
      const objs = objects.filter(Boolean) as fabric.FabricObject[]
      mockupObjects.current = objs

      objs.forEach(obj => {
        obj.set({
          selectable: false,
          evented: true,
          hoverCursor: 'crosshair',
        })
        canvas.add(obj)
      })

      // Center and scale mockup — compute bounds from objects
      const allLeft = objs.map(o => o.left ?? 0)
      const allTop  = objs.map(o => o.top  ?? 0)
      const allRight  = objs.map(o => (o.left ?? 0) + (o.width  ?? 0) * (o.scaleX ?? 1))
      const allBottom = objs.map(o => (o.top  ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
      const bx = Math.min(...allLeft)
      const by = Math.min(...allTop)
      const bw = Math.max(...allRight)  - bx
      const bh = Math.max(...allBottom) - by
      const scale = Math.min(500 / bw, 500 / bh)
      const offsetX = (600 - bw * scale) / 2 - bx * scale
      const offsetY = (600 - bh * scale) / 2 - by * scale

      objs.forEach(obj => {
        obj.set({
          left: (obj.left ?? 0) * scale + offsetX,
          top: (obj.top ?? 0) * scale + offsetY,
          scaleX: (obj.scaleX ?? 1) * scale,
          scaleY: (obj.scaleY ?? 1) * scale,
        })
      })

      canvas.renderAll()
    })

    return () => {
      canvas.dispose()
    }
  }, [project.mockupId])

  // Sync tool changes to canvas
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

    if (tool === 'select') {
      mockupObjects.current.forEach(obj => { obj.set({ selectable: false }) })
      canvas.selection = true
    }
  }, [tool, color, brushSize])

  // Sync brush color/size when they change in draw mode
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || tool !== 'draw') return
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color
      canvas.freeDrawingBrush.width = brushSize
    }
  }, [color, brushSize, tool])

  // Fill tool: click mockup zone to fill
  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return

    function handleMouseDown(e: fabric.TPointerEventInfo) {
      if (tool !== 'fill') return
      const target = e.target
      if (!target) return
      if (mockupObjects.current.includes(target)) {
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
      {/* Top bar */}
      <header className="editor-topbar">
        <button className="editor-back" onClick={onBack}>
          <span>←</span> RAW
        </button>
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
        {/* Left toolbar */}
        <aside className="editor-toolbar">
          <ToolBtn icon="↖" label="Seleccionar" active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Dibujar" active={tool === 'draw'} onClick={() => setTool('draw')} />
          <ToolBtn icon="▣" label="Rellenar" active={tool === 'fill'} onClick={() => setTool('fill')} />

          <div className="editor-toolbar-divider" />

          {/* Color picker */}
          <div className="editor-color-wrap" title="Color">
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="editor-color-input"
            />
            <div className="editor-color-swatch" style={{ background: color }} />
          </div>

          {/* Brush size — only relevant in draw mode */}
          {tool === 'draw' && (
            <div className="editor-brush-wrap">
              <input
                type="range"
                min={1}
                max={50}
                value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="editor-brush-slider"
                title={`Tamaño: ${brushSize}px`}
              />
              <span className="editor-brush-label">{brushSize}</span>
            </div>
          )}
        </aside>

        {/* Canvas */}
        <main className="editor-canvas-area">
          <canvas ref={canvasEl} />
        </main>
      </div>
    </div>
  )
}

function ToolBtn({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`editor-tool-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
    >
      {icon}
    </button>
  )
}
