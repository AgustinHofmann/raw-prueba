import { useState, useRef, useEffect } from 'react'
import * as fabric from 'fabric'
import type { Project } from '../types/project'
import type { TechPackMeasures } from '../components/TechPackSheet'

interface Props {
  project: Project
  designer: string
  garmentImg: string | null
  measures: TechPackMeasures | null
  onBack: () => void
}

type MeasRow = { code: string; label: string; cm: string; tol: string }
type BomRow  = { material: string; desc: string; consumo: string; proveedor: string }
type TpTool  = 'select' | 'arrow' | 'text' | 'rect'

const MEAS_DEFS: { key: keyof TechPackMeasures; label: string; code: string }[] = [
  { key: 'largoTotal',        label: 'Largo total',           code: 'A' },
  { key: 'anchoPecho',        label: 'Ancho de pecho',        code: 'B' },
  { key: 'anchoCintura',      label: 'Ancho de cintura',      code: 'C' },
  { key: 'anchoCuello',       label: 'Ancho de cuello',       code: 'D' },
  { key: 'profundidadCuello', label: 'Profundidad de cuello', code: 'E' },
  { key: 'largoManga',        label: 'Largo de manga',        code: 'F' },
  { key: 'anchoManga',        label: 'Ancho de manga',        code: 'G' },
]

const CANVAS_W = 714
const CANVAS_H = 470

const inputCss: React.CSSProperties = { background: 'var(--panel-2, #2a2a2a)', color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)', borderRadius: 5, padding: '6px 8px', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' }
const labelCss: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-dim, #888)', fontWeight: 600 }

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      <span style={labelCss}>{label}</span>
      <input style={inputCss} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export default function TechPackScreen({ project, designer, garmentImg, measures, onBack }: Props) {
  const garmentName = project.mockupId === 'tshirt' ? 'Remera' : project.mockupId === 'hoodie' ? 'Buzo' : 'Pantalón'

  // ── Estado editable (datos del tech pack) ──
  const [estilo,    setEstilo]    = useState(project.name)
  const [codigo,    setCodigo]    = useState(`RAW-${project.id.slice(0, 6).toUpperCase()}`)
  const [prenda,    setPrenda]    = useState(garmentName)
  const [temporada, setTemporada] = useState('SS26')
  const [marca,     setMarca]     = useState('RAW Design')
  const [disen,     setDisen]     = useState(designer)
  const [fecha,     setFecha]     = useState(new Date(project.createdAt).toLocaleDateString('es-AR'))
  const [revision,  setRevision]  = useState('R1')
  const [talles,    setTalles]    = useState('S · M · L · XL')

  const [meas, setMeas] = useState<MeasRow[]>(
    measures
      ? MEAS_DEFS.map(d => ({ code: d.code, label: d.label, cm: String(measures[d.key]), tol: '±0.5' }))
      : [{ code: 'A', label: '', cm: '', tol: '±0.5' }]
  )
  const [colors, setColors] = useState<string[]>(project.colors && project.colors.length ? project.colors : ['#1a1a1a'])
  const [bom, setBom] = useState<BomRow[]>([
    { material: 'Tela principal', desc: 'Jersey de algodón 180gr', consumo: '1.2 m', proveedor: '' },
    { material: 'Hilo',           desc: 'Poliéster tono a tono',   consumo: '—',     proveedor: '' },
    { material: 'Etiqueta marca', desc: 'Tejida, cuello interior', consumo: '1 u',   proveedor: '' },
  ])
  const [notas, setNotas] = useState('Costuras: overlock 4 hilos. Cuello: ribb 1x1. Pretina y puños: recto. Etiqueta de composición en costado izquierdo.')

  // ── Estado del editor de anotaciones ──
  const [tool, setTool]   = useState<TpTool>('select')
  const [color, setColor] = useState('#d11')
  const canvasEl = useRef<HTMLCanvasElement>(null)
  const fc       = useRef<fabric.Canvas | null>(null)
  const toolRef  = useRef<TpTool>('select')
  const colorRef = useRef('#d11')
  toolRef.current = tool
  colorRef.current = color

  // ── Init del canvas Fabric (una sola vez) ──
  useEffect(() => {
    if (!canvasEl.current) return
    const canvas = new fabric.Canvas(canvasEl.current, {
      width: CANVAS_W, height: CANVAS_H, backgroundColor: '#fafafa',
      preserveObjectStacking: true,
    })
    fc.current = canvas

    if (garmentImg) {
      fabric.FabricImage.fromURL(garmentImg, { crossOrigin: 'anonymous' }).then(img => {
        const maxH = CANVAS_H - 40, maxW = CANVAS_W * 0.55
        const sc = Math.min(maxW / (img.width || 1), maxH / (img.height || 1))
        img.scale(sc)
        img.set({ left: CANVAS_W * 0.30, top: CANVAS_H / 2, originX: 'center', originY: 'center' })
        img.set({ selectable: true, hasControls: true })
        ;(img as any).tpKind = 'garment'
        canvas.add(img)
        canvas.sendObjectToBack(img)
        canvas.requestRenderAll()
      })
    }

    return () => { canvas.dispose(); fc.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Crea una flecha (línea + punta) como grupo movible ──
  function makeArrow(x1: number, y1: number, x2: number, y2: number, stroke: string) {
    const line = new fabric.Line([x1, y1, x2, y2], { stroke, strokeWidth: 2, selectable: false, evented: false })
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
    const head = new fabric.Triangle({
      left: x2, top: y2, originX: 'center', originY: 'center',
      width: 12, height: 14, fill: stroke, angle: angle + 90,
      selectable: false, evented: false,
    })
    return new fabric.Group([line, head], { objectCaching: false })
  }

  // ── Handlers por herramienta ──
  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return
    const draw = tool !== 'select'
    canvas.selection = !draw
    canvas.skipTargetFind = draw
    canvas.defaultCursor = draw ? 'crosshair' : 'default'
    canvas.forEachObject(o => { o.selectable = !draw })
    if (draw) canvas.discardActiveObject()
    canvas.requestRenderAll()

    let start: { x: number; y: number } | null = null
    let temp: fabric.Object | null = null

    const onDown = (e: any) => {
      if (toolRef.current === 'select') return
      const p = e.scenePoint
      start = { x: p.x, y: p.y }
      const c = colorRef.current
      if (toolRef.current === 'text') {
        const t = new fabric.IText('Texto', {
          left: p.x, top: p.y, fontSize: 18, fill: c, fontFamily: 'Arial',
        })
        canvas.add(t); canvas.setActiveObject(t)
        ;(t as any).enterEditing?.(); t.selectAll?.()
        setTool('select')
        start = null
      } else if (toolRef.current === 'rect') {
        temp = new fabric.Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: 'transparent', stroke: c, strokeWidth: 2 })
        canvas.add(temp)
      } else if (toolRef.current === 'arrow') {
        temp = new fabric.Line([p.x, p.y, p.x, p.y], { stroke: c, strokeWidth: 2, strokeDashArray: [4, 4] })
        canvas.add(temp)
      }
    }
    const onMove = (e: any) => {
      if (!start || !temp) return
      const p = e.scenePoint
      if (toolRef.current === 'rect') {
        (temp as fabric.Rect).set({ width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y), left: Math.min(p.x, start.x), top: Math.min(p.y, start.y) })
      } else if (toolRef.current === 'arrow') {
        (temp as fabric.Line).set({ x2: p.x, y2: p.y })
      }
      canvas.requestRenderAll()
    }
    const onUp = (e: any) => {
      if (!start) return
      const p = e.scenePoint
      const c = colorRef.current
      if (toolRef.current === 'arrow') {
        if (temp) { canvas.remove(temp); temp = null }
        if (Math.hypot(p.x - start.x, p.y - start.y) > 6) {
          canvas.add(makeArrow(start.x, start.y, p.x, p.y, c))
        }
        setTool('select')
      } else if (toolRef.current === 'rect') {
        if (temp && ((temp as fabric.Rect).width! < 4 || (temp as fabric.Rect).height! < 4)) canvas.remove(temp)
        temp = null
        setTool('select')
      }
      start = null
      canvas.requestRenderAll()
    }

    canvas.on('mouse:down', onDown)
    canvas.on('mouse:move', onMove)
    canvas.on('mouse:up', onUp)
    return () => {
      canvas.off('mouse:down', onDown)
      canvas.off('mouse:move', onMove)
      canvas.off('mouse:up', onUp)
    }
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Borrar selección con Delete/Backspace ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const canvas = fc.current
      if (!canvas) return
      const act = canvas.getActiveObject() as any
      if (act?.isEditing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const objs = canvas.getActiveObjects()
        if (objs.length) {
          e.preventDefault()
          objs.forEach(o => canvas.remove(o))
          canvas.discardActiveObject()
          canvas.requestRenderAll()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function deleteSelection() {
    const canvas = fc.current; if (!canvas) return
    canvas.getActiveObjects().forEach(o => canvas.remove(o))
    canvas.discardActiveObject(); canvas.requestRenderAll()
  }

  function addImageToCanvas(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const canvas = fc.current; if (!canvas) return
    const reader = new FileReader()
    reader.onload = () => {
      fabric.FabricImage.fromURL(reader.result as string).then(img => {
        const sc = Math.min(220 / (img.width || 1), 220 / (img.height || 1))
        img.scale(sc); img.set({ left: CANVAS_W * 0.7, top: CANVAS_H / 2, originX: 'center', originY: 'center' })
        canvas.add(img); canvas.setActiveObject(img); canvas.requestRenderAll()
      })
    }
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  // ── Helpers de edición de datos ──
  const setMeasRow = (i: number, k: keyof MeasRow, v: string) => setMeas(rows => rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const addMeasRow = () => setMeas(rows => [...rows, { code: '', label: '', cm: '', tol: '±0.5' }])
  const delMeasRow = (i: number) => setMeas(rows => rows.filter((_, j) => j !== i))
  const setBomRow = (i: number, k: keyof BomRow, v: string) => setBom(rows => rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const addBomRow = () => setBom(rows => [...rows, { material: '', desc: '', consumo: '', proveedor: '' }])
  const delBomRow = (i: number) => setBom(rows => rows.filter((_, j) => j !== i))
  const setColorAt = (i: number, v: string) => setColors(cs => cs.map((c, j) => j === i ? v : c))
  const addColor = () => setColors(cs => [...cs, '#888888'])
  const delColor = (i: number) => setColors(cs => cs.filter((_, j) => j !== i))

  const cell: React.CSSProperties = { border: '1px solid #999', padding: '5px 8px', fontSize: 11 }
  const th: React.CSSProperties = { ...cell, borderColor: '#111', color: '#fff', background: '#111' }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg, #1e1e1e)' }}>
      {/* ── Panel lateral con secciones desplegables ── */}
      <div className="no-print" style={{ width: 350, flexShrink: 0, borderRight: '1px solid var(--border, #444)', overflowY: 'auto', padding: '14px 16px' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg, #eee)' }}>Editor de Tech Pack</div>
        <div style={{ fontSize: 11, color: 'var(--fg-dim, #888)', marginBottom: 8 }}>Anotá la prenda y completá la ficha</div>

        <Section title="Información general" defaultOpen>
          <Field label="Estilo" value={estilo} onChange={setEstilo} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field label="Código" value={codigo} onChange={setCodigo} /></div>
            <div style={{ flex: 1 }}><Field label="Revisión" value={revision} onChange={setRevision} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field label="Prenda" value={prenda} onChange={setPrenda} /></div>
            <div style={{ flex: 1 }}><Field label="Temporada" value={temporada} onChange={setTemporada} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field label="Marca" value={marca} onChange={setMarca} /></div>
            <div style={{ flex: 1 }}><Field label="Fecha" value={fecha} onChange={setFecha} /></div>
          </div>
          <Field label="Diseñador" value={disen} onChange={setDisen} />
          <Field label="Talles" value={talles} onChange={setTalles} />
        </Section>

        <Section title="Medidas (POM)" defaultOpen>
          {meas.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 6, alignItems: 'center' }}>
              <input style={{ ...inputCss, width: 30, padding: '6px 3px', textAlign: 'center' }} value={r.code} onChange={e => setMeasRow(i, 'code', e.target.value)} />
              <input style={{ ...inputCss, flex: 1 }} placeholder="Punto" value={r.label} onChange={e => setMeasRow(i, 'label', e.target.value)} />
              <input style={{ ...inputCss, width: 48 }} placeholder="cm" value={r.cm} onChange={e => setMeasRow(i, 'cm', e.target.value)} />
              <input style={{ ...inputCss, width: 46 }} placeholder="tol" value={r.tol} onChange={e => setMeasRow(i, 'tol', e.target.value)} />
              <button onClick={() => delMeasRow(i)} className="btn" style={{ fontSize: 13, padding: '4px 7px' }}>×</button>
            </div>
          ))}
          <button onClick={addMeasRow} className="btn" style={{ fontSize: 12 }}>+ Medida</button>
        </Section>

        <Section title="Colorway">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {colors.map((c, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <input type="color" value={c} onChange={e => setColorAt(i, e.target.value)} style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
                <button onClick={() => delColor(i)} className="btn" style={{ fontSize: 11, padding: '1px 6px' }}>×</button>
              </div>
            ))}
            <button onClick={addColor} className="btn" style={{ fontSize: 18, alignSelf: 'center', padding: '2px 10px' }}>+</button>
          </div>
        </Section>

        <Section title="Materiales (BOM)">
          {bom.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed var(--border, #444)' }}>
              <div style={{ display: 'flex', gap: 5 }}>
                <input style={{ ...inputCss, flex: 1 }} placeholder="Material" value={r.material} onChange={e => setBomRow(i, 'material', e.target.value)} />
                <button onClick={() => delBomRow(i)} className="btn" style={{ fontSize: 13, padding: '4px 7px' }}>×</button>
              </div>
              <input style={inputCss} placeholder="Descripción" value={r.desc} onChange={e => setBomRow(i, 'desc', e.target.value)} />
              <div style={{ display: 'flex', gap: 5 }}>
                <input style={{ ...inputCss, flex: 1 }} placeholder="Consumo" value={r.consumo} onChange={e => setBomRow(i, 'consumo', e.target.value)} />
                <input style={{ ...inputCss, flex: 1 }} placeholder="Proveedor" value={r.proveedor} onChange={e => setBomRow(i, 'proveedor', e.target.value)} />
              </div>
            </div>
          ))}
          <button onClick={addBomRow} className="btn" style={{ fontSize: 12 }}>+ Material</button>
        </Section>

        <Section title="Construcción / Notas">
          <textarea value={notas} onChange={e => setNotas(e.target.value)} style={{ ...inputCss, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }} />
        </Section>
        <div style={{ height: 24 }} />
      </div>

      {/* ── Zona central: toolbar + plantilla A4 ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar de anotación */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border, #444)', flexWrap: 'wrap' }}>
          <button onClick={onBack} className="btn" style={{ fontSize: 12 }}>← Volver</button>
          <div style={{ width: 1, height: 22, background: 'var(--border, #444)', margin: '0 4px' }} />
          <TpToolBtn label="🖱 Seleccionar" active={tool === 'select'} onClick={() => setTool('select')} />
          <TpToolBtn label="↘ Flecha"       active={tool === 'arrow'}  onClick={() => setTool('arrow')} />
          <TpToolBtn label="🏷 Texto"        active={tool === 'text'}   onClick={() => setTool('text')} />
          <TpToolBtn label="▭ Rectángulo"   active={tool === 'rect'}   onClick={() => setTool('rect')} />
          <input type="color" value={color} onChange={e => setColor(e.target.value)} title="Color de anotación"
            style={{ width: 30, height: 28, border: 'none', background: 'none', cursor: 'pointer' }} />
          <button onClick={deleteSelection} className="btn" style={{ fontSize: 12 }}>🗑 Borrar</button>
          <label className="btn" style={{ fontSize: 12, cursor: 'pointer' }}>
            🖼 Agregar imagen
            <input type="file" accept="image/*" onChange={addImageToCanvas} style={{ display: 'none' }} />
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: 12 }}>🖨 Exportar PDF</button>
        </div>

        {/* Plantilla A4 (imprimible) */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '20px 0', background: 'var(--bg-2, #161616)' }}>
          <div id="techpack-print" style={{ width: 794, minHeight: 1123, background: '#fff', color: '#111', padding: 40, boxSizing: 'border-box', fontFamily: 'Arial, sans-serif', boxShadow: '0 20px 60px rgb(0 0 0 / 0.5)', height: 'fit-content' }}>
            {/* Encabezado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #111', paddingBottom: 12 }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{marca}</div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Ficha técnica · Tech Pack</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.7 }}>
                <div><b>Estilo:</b> {estilo}</div>
                <div><b>Código:</b> {codigo} · <b>Rev:</b> {revision}</div>
                <div><b>Prenda:</b> {prenda} · <b>Temp:</b> {temporada}</div>
                <div><b>Talles:</b> {talles}</div>
                <div><b>Fecha:</b> {fecha} · <b>Diseñador:</b> {disen}</div>
              </div>
            </div>

            {/* Flat sketch con llamadas (canvas de anotación) */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Dibujo técnico · llamadas</div>
              <div style={{ border: '1px solid #ddd', borderRadius: 4 }}>
                <canvas ref={canvasEl} />
              </div>
            </div>

            {/* Medidas + Colorway */}
            <div style={{ display: 'flex', gap: 18, marginTop: 18, alignItems: 'flex-start' }}>
              <div style={{ flex: 1.5 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Tabla de medidas (cm)</div>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr><th style={th}>#</th><th style={{ ...th, textAlign: 'left' }}>Punto de medida</th><th style={th}>cm</th><th style={th}>Tol.</th></tr></thead>
                  <tbody>
                    {meas.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{r.code}</td>
                        <td style={cell}>{r.label}</td>
                        <td style={{ ...cell, textAlign: 'right', fontFamily: 'monospace' }}>{r.cm}</td>
                        <td style={{ ...cell, textAlign: 'center', fontFamily: 'monospace', color: '#666' }}>{r.tol}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Colorway</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {colors.map((c, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ width: 46, height: 46, background: c, border: '1px solid #999', borderRadius: 4 }} />
                      <div style={{ fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{c.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* BOM */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Materiales (BOM)</div>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={{ ...th, textAlign: 'left' }}>Material</th><th style={{ ...th, textAlign: 'left' }}>Descripción</th><th style={th}>Consumo</th><th style={{ ...th, textAlign: 'left' }}>Proveedor</th></tr></thead>
                <tbody>
                  {bom.map((r, i) => (
                    <tr key={i}><td style={cell}>{r.material}</td><td style={cell}>{r.desc}</td><td style={{ ...cell, textAlign: 'center' }}>{r.consumo}</td><td style={cell}>{r.proveedor}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notas */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Construcción / Notas</div>
              <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 10, fontSize: 11, whiteSpace: 'pre-wrap', lineHeight: 1.5, minHeight: 50 }}>{notas}</div>
            </div>

            {/* Pie */}
            <div style={{ borderTop: '1px solid #ccc', marginTop: 22, paddingTop: 8, fontSize: 9, color: '#999', display: 'flex', justifyContent: 'space-between' }}>
              <span>{marca} — Tech Pack</span><span>{codigo} · {revision} · {fecha}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sección desplegable del panel ──
function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div style={{ borderBottom: '1px solid var(--border, #444)', padding: '4px 0' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0', color: 'var(--fg, #eee)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--fg-dim, #888)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ paddingBottom: 10 }}>{children}</div>}
    </div>
  )
}

// ── Botón de herramienta ──
function TpToolBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn" style={{
      fontSize: 12,
      background: active ? 'var(--accent, #7a8c00)' : undefined,
      color: active ? '#fff' : undefined,
      borderColor: active ? 'var(--accent, #7a8c00)' : undefined,
    }}>{label}</button>
  )
}
