import { useState, useEffect, useRef } from 'react'
import {
  ChevronLeft, ZoomIn, ZoomOut, Printer, X, Plus, GripVertical, Trash2,
  MousePointer2, ArrowUpRight, Minus, Hash, Circle, Image as ImageIcon,
  Shirt, Ruler, Package, Palette, FileText, PencilRuler, type LucideIcon,
} from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type {
  Project, TechPackMeasures, TechPackDoc, TechPackPage, TechPackPageKind,
  BomRow, PomRow, Annotation, AnnotationCategory, TechPackMeta, ImageRole,
} from '../types/project'
import { buildDefaultTechPack, parseTechPack, makePage, PAGE_CATALOG, garmentName } from '../lib/techpackTemplate'
import AnnotationLayer, { type AnnTool } from './AnnotationLayer'

interface Props {
  project: Project
  designer: string
  snapshot: string
  measures: TechPackMeasures | null
  onSave: (doc: TechPackDoc) => void
  onBackToEditor: () => void
  onClose: () => void
  onToast?: (m: string) => void
}

const uid = () => crypto.randomUUID()
const PAGE_W = 1123, PAGE_H = 794   // A4 apaisado a 96dpi

const PAGE_ICON: Record<TechPackPageKind, LucideIcon> = {
  design: Shirt, specs: PencilRuler, measures: Ruler, materials: Package, colorways: Palette, notes: FileText,
}

const ANN_TOOLS: { tool: AnnTool; icon: LucideIcon; label: string }[] = [
  { tool: 'select',  icon: MousePointer2, label: 'Seleccionar / mover' },
  { tool: 'arrow',   icon: ArrowUpRight,  label: 'Flecha' },
  { tool: 'leader',  icon: Minus,         label: 'Línea guía' },
  { tool: 'callout', icon: Hash,          label: 'Callout numerado' },
  { tool: 'bubble',  icon: Circle,        label: 'Burbuja de detalle' },
]
const ANN_CATS: { cat: AnnotationCategory; label: string; color: string }[] = [
  { cat: 'construccion', label: 'Construcción', color: '#1d4ed8' },
  { cat: 'material',     label: 'Material',     color: '#6b7a00' },
  { cat: 'medida',       label: 'Medida',       color: '#b91c1c' },
]

// estilos de tabla impresa
const th: React.CSSProperties = { border: '1px solid #999', padding: '5px 7px', fontSize: 10.5, background: '#1a1a1a', color: '#fff', textAlign: 'left', fontWeight: 600 }
const td: React.CSSProperties = { border: '1px solid #ccc', padding: 0, fontSize: 10.5, verticalAlign: 'top' }
const ci: React.CSSProperties = { width: '100%', border: 'none', outline: 'none', padding: '5px 7px', fontSize: 10.5, fontFamily: 'Arial', color: '#111', background: 'transparent', boxSizing: 'border-box' }

export default function TechPackScreen({ project, designer, snapshot, measures, onSave, onBackToEditor, onClose }: Props) {
  const [doc, setDoc] = useState<TechPackDoc>(
    () => parseTechPack(project.techpackJson) ?? buildDefaultTechPack(project, measures, snapshot),
  )
  const [zoom, setZoom]       = useState(0.7)
  const [annTool, setAnnTool] = useState<AnnTool>('select')
  const [annCat, setAnnCat]   = useState<AnnotationCategory>('construccion')
  const [activePage, setActivePage] = useState<string | null>(doc.pages[0]?.id ?? null)
  const [addOpen, setAddOpen] = useState(false)
  const [saved, setSaved]     = useState(true)
  const firstRun = useRef(true)
  const saveRef  = useRef(onSave); saveRef.current = onSave

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setSaved(false)
    const id = window.setTimeout(() => { saveRef.current(doc); setSaved(true) }, 1000)
    return () => window.clearTimeout(id)
  }, [doc])

  // ─── mutadores ──────────────────────────────────────────────────────────────
  const update = (mut: (d: TechPackDoc) => TechPackDoc) => setDoc(prev => mut(prev))
  const patchPage = (id: string, patch: Partial<TechPackPage>) =>
    update(d => ({ ...d, pages: d.pages.map(p => p.id === id ? { ...p, ...patch } : p) }))
  const removePage = (id: string) => update(d => ({ ...d, pages: d.pages.filter(p => p.id !== id) }))
  const addPage = (kind: TechPackPageKind) => { update(d => ({ ...d, pages: [...d.pages, makePage(kind, project.mockupId)] })); setAddOpen(false) }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    update(d => {
      const oi = d.pages.findIndex(p => p.id === active.id)
      const ni = d.pages.findIndex(p => p.id === over.id)
      return oi < 0 || ni < 0 ? d : { ...d, pages: arrayMove(d.pages, oi, ni) }
    })
  }
  const patchMeta = (patch: Partial<TechPackMeta>) => update(d => ({ ...d, meta: { ...d.meta, ...patch } }))
  const patchBom = (id: string, patch: Partial<BomRow>) => update(d => ({ ...d, bom: d.bom.map(r => r.id === id ? { ...r, ...patch } : r) }))
  const addBom = () => update(d => ({ ...d, bom: [...d.bom, { id: uid(), categoria: 'Trim', descripcion: '', placement: '', composicion: '', color: '', proveedor: '', consumo: '', uom: 'u', notas: '' }] }))
  const removeBom = (id: string) => update(d => ({ ...d, bom: d.bom.filter(r => r.id !== id) }))
  const patchPom = (id: string, patch: Partial<PomRow>) => update(d => ({ ...d, poms: d.poms.map(r => r.id === id ? { ...r, ...patch } : r) }))
  const addPom = () => update(d => ({ ...d, poms: [...d.poms, { id: uid(), code: '', punto: '', comoMedir: '', tolerancia: '', base: null }] }))
  const removePom = (id: string) => update(d => ({ ...d, poms: d.poms.filter(r => r.id !== id) }))
  const replaceImage = (role: ImageRole, src: string) => update(d => ({ ...d, images: d.images.map(im => im.role === role ? { ...im, src } : im) }))
  const addAnnotation = (a: Annotation) => update(d => ({ ...d, annotations: [...d.annotations, a] }))
  const patchAnnotation = (id: string, patch: Partial<Annotation>) => update(d => ({ ...d, annotations: d.annotations.map(a => a.id === id ? { ...a, ...patch } : a) }))
  const removeAnnotation = (id: string) => update(d => ({ ...d, annotations: d.annotations.filter(a => a.id !== id) }))
  const nextAnnNumber = () => doc.annotations.reduce((m, a) => Math.max(m, a.number ?? 0), 0) + 1

  const slot = (role: ImageRole) => doc.images.find(im => im.role === role)
  const annsForSlot = (slotId: string | undefined) => slotId ? doc.annotations.filter(a => a.slotId === slotId) : []

  function pickImage(role: ImageRole) {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.webp,.gif'
    input.onchange = () => {
      const f = input.files?.[0]; if (!f) return
      const r = new FileReader(); r.onload = e => replaceImage(role, e.target?.result as string); r.readAsDataURL(f)
    }
    input.click()
  }
  const goToPage = (id: string) => { setActivePage(id); document.getElementById(`tp-page-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  const styleNo = `RAW-${project.id.slice(0, 6).toUpperCase()}`
  const date = new Date(project.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Barra superior limpia */}
      <div className="no-print" style={{ flexShrink: 0, height: 50, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--line-soft)' }}>
        <button onClick={onBackToEditor} className="btn btn-ghost" style={{ fontSize: 13, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChevronLeft size={16} /> Editor
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--line)' }} />
        <FileText size={15} style={{ color: 'var(--muted)' }} />
        <span className="display-i" style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{project.name}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>· {garmentName(project.mockupId)}</span>
        <span className="mono" style={{ fontSize: 10, color: saved ? 'var(--muted)' : 'var(--accent)' }}>{saved ? '· guardado' : '· guardando…'}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconButton title="Alejar" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))}><ZoomOut size={16} /></IconButton>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', width: 38, textAlign: 'center', cursor: 'pointer' }} onClick={() => setZoom(0.7)} title="Restablecer">{Math.round(zoom * 100)}%</span>
          <IconButton title="Acercar" onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(2)))}><ZoomIn size={16} /></IconButton>
          <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 6px' }} />
          <button onClick={() => window.print()} className="btn btn-primary" style={{ fontSize: 13, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Printer size={15} /> Exportar PDF
          </button>
          <IconButton title="Cerrar ficha" onClick={onClose}><X size={17} /></IconButton>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Riel de páginas (reordenable) */}
        <aside className="no-print scroll-hide" style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--line-soft)', overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="label" style={{ marginBottom: 4 }}>Páginas</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={doc.pages.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {doc.pages.map((p, i) => (
                <SortablePageItem
                  key={p.id} page={p} index={i} total={doc.pages.length}
                  Icon={PAGE_ICON[p.kind]} active={activePage === p.id}
                  onSelect={() => goToPage(p.id)}
                  onDelete={() => removePage(p.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div style={{ position: 'relative', marginTop: 6 }}>
            <button onClick={() => setAddOpen(v => !v)} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: 12, padding: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Agregar página
            </button>
            {addOpen && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 10, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
                {PAGE_CATALOG.map(c => {
                  const I = PAGE_ICON[c.kind]
                  return (
                    <button key={c.kind} onClick={() => addPage(c.kind)} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 12, fontFamily: 'var(--ui)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <I size={14} style={{ color: 'var(--muted)' }} /> {c.title}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Documento: páginas apaisadas apiladas */}
        <div className="scroll-hide" style={{ flex: 1, overflow: 'auto', background: 'var(--surface)', padding: '28px 0 90px' }}>
          <div id="techpack-print" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(28 * zoom) }}>
            {doc.pages.map((p, i) => (
              <div
                key={p.id} id={`tp-page-${p.id}`} className="tp-page"
                style={{ width: PAGE_W, minHeight: PAGE_H, background: '#fff', color: '#111', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif', boxShadow: '0 10px 40px rgb(0 0 0 / 0.35)', transform: `scale(${zoom})`, transformOrigin: 'top center', marginBottom: PAGE_H * (zoom - 1) }}
                onMouseDown={() => setActivePage(p.id)}
              >
                {renderPage(p, i)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar de anotaciones — único, compacto, flotante */}
      <div className="no-print" style={{
        position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 120,
        display: 'flex', alignItems: 'center', gap: 4, padding: 5,
        background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow-lg)',
      }}>
        {ANN_TOOLS.map(({ tool, icon: I, label }) => (
          <IconButton key={tool} title={label} active={annTool === tool} onClick={() => setAnnTool(tool)}><I size={16} /></IconButton>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 3px' }} />
        {ANN_CATS.map(({ cat, label, color }) => (
          <button key={cat} title={label} onClick={() => setAnnCat(cat)}
            style={{ width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', border: annCat === cat ? `2px solid ${color}` : '2px solid transparent', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <span style={{ width: 13, height: 13, borderRadius: '50%', background: color, display: 'block' }} />
          </button>
        ))}
        {annTool !== 'select' && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', padding: '0 8px', maxWidth: 160 }}>click en la prenda para anotar</span>
        )}
      </div>
    </div>
  )

  // ─── render de página ─────────────────────────────────────────────────────
  function renderPage(p: TechPackPage, index: number) {
    const onDesign = p.kind === 'design'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 32, boxSizing: 'border-box' }}>
        {/* Cabecera de página — compacta y enfocada en fábrica */}
        <div style={{ borderBottom: '2px solid #111', paddingBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>RAW <span style={{ color: '#7a8c00' }}>Design</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#333' }}>{p.title}</span>
            </div>
            <div style={{ display: 'flex', gap: 18, fontSize: 10, color: '#444', textAlign: 'right' }}>
              <span><b>{project.name}</b> · {garmentName(project.mockupId)}</span>
              <span>{styleNo}</span>
              <span>{designer} · {date}</span>
              <span style={{ color: '#888' }}>Pág {index + 1}/{doc.pages.length}</span>
            </div>
          </div>
          {onDesign && (
            <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
              <MetaField label="Para (fábrica/taller)" value={doc.meta.fabricaProveedor} onChange={v => patchMeta({ fabricaProveedor: v })} w={220} />
              <MetaField label="Tela principal" value={doc.meta.telaPrincipal} onChange={v => patchMeta({ telaPrincipal: v })} w={240} />
              <MetaField label="Talle base" value={doc.meta.talleBase} onChange={v => patchMeta({ talleBase: v })} w={70} />
              <MetaField label="Rango de talles" value={doc.meta.rangoTalles} onChange={v => patchMeta({ rangoTalles: v })} w={100} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, marginTop: 14 }}>
          {p.kind === 'design'    && renderDesign()}
          {p.kind === 'specs'     && renderSpecs(p)}
          {p.kind === 'measures'  && renderMeasures()}
          {p.kind === 'materials' && renderMaterials()}
          {p.kind === 'colorways' && renderColorways()}
          {p.kind === 'notes'     && renderNotes(p)}
        </div>
      </div>
    )
  }

  function imageBox(role: ImageRole, label: string, h = 540) {
    const s = slot(role)
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #e3e3e3', borderRadius: 6, overflow: 'hidden', background: '#fafafa', minWidth: 0 }}>
        <div style={{ height: h, position: 'relative' }}>
          <AnnotationLayer
            slotId={s?.id ?? role} src={s?.src ?? null} alt={label} height="100%"
            annotations={annsForSlot(s?.id)} tool={annTool} category={annCat}
            onCreate={addAnnotation} onUpdate={patchAnnotation} onDelete={removeAnnotation} nextNumber={nextAnnNumber}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderTop: '1px solid #eee', background: '#fff' }}>
          <span style={{ fontSize: 10, color: '#555', flex: 1, fontWeight: 600 }}>{label}</span>
          <button className="no-print" onClick={() => pickImage(role)} style={btnTiny}><ImageIcon size={11} /> {s?.src ? 'Reemplazar' : 'Agregar'}</button>
        </div>
      </div>
    )
  }

  function renderDesign() {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {imageBox('front', 'Frente', 560)}
        {imageBox('back', 'Espalda', 560)}
      </div>
    )
  }

  function renderSpecs(p: TechPackPage) {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1.3, display: 'flex' }}>{imageBox('specs', 'Vista con especificaciones', 560)}</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionTitle>Construcción y acabados</SectionTitle>
          <textarea value={p.body} onChange={e => patchPage(p.id, { body: e.target.value })} placeholder="Detalles de costura, puntadas, refuerzos, acabados…"
            style={{ height: 300, border: '1px solid #ddd', borderRadius: 6, padding: 10, fontSize: 11, fontFamily: 'Arial', resize: 'none', color: '#111', background: '#fff' }} />
          <SectionTitle>Materiales principales</SectionTitle>
          <div style={{ border: '1px solid #eee', borderRadius: 6, padding: '6px 10px' }}>
            {doc.bom.slice(0, 4).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '2px 0' }}>
                {r.color ? <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, border: '1px solid #999', flexShrink: 0 }} /> : <span style={{ width: 10 }} />}
                <span style={{ color: '#444', flex: 1 }}>{r.descripcion || '—'}</span>
                <span style={{ color: '#888' }}>{r.composicion}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderMeasures() {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex' }}>{imageBox('measures', 'Puntos de medida', 520)}</div>
        <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead><tr>
              <th style={{ ...th, width: 30 }}>#</th>
              <th style={th}>Punto de medida</th>
              <th style={th}>Cómo medir</th>
              <th style={{ ...th, width: 56 }}>Base</th>
              <th style={{ ...th, width: 44 }}>Tol.±</th>
              <th style={{ ...th, width: 22 }} className="no-print"></th>
            </tr></thead>
            <tbody>
              {doc.poms.map(r => (
                <tr key={r.id}>
                  <td style={td}><input style={{ ...ci, textAlign: 'center', fontWeight: 700 }} value={r.code} onChange={e => patchPom(r.id, { code: e.target.value })} /></td>
                  <td style={td}><input style={ci} value={r.punto} onChange={e => patchPom(r.id, { punto: e.target.value })} /></td>
                  <td style={td}><input style={ci} value={r.comoMedir} onChange={e => patchPom(r.id, { comoMedir: e.target.value })} /></td>
                  <td style={td}><input style={{ ...ci, textAlign: 'right', fontFamily: 'monospace' }} value={r.base ?? ''} onChange={e => patchPom(r.id, { base: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td style={td}><input style={{ ...ci, textAlign: 'center' }} value={r.tolerancia} onChange={e => patchPom(r.id, { tolerancia: e.target.value })} /></td>
                  <td style={{ ...td, textAlign: 'center' }} className="no-print"><button onClick={() => removePom(r.id)} style={delBtn}><Trash2 size={11} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="no-print" onClick={addPom} style={addRowBtn}><Plus size={11} /> Agregar medida</button>
          {!measures && <div style={{ fontSize: 10, color: '#888', marginTop: 6 }}>El talle base se autocompleta para la remera paramétrica; acá cargalo a mano.</div>}
        </div>
      </div>
    )
  }

  function renderMaterials() {
    return (
      <div>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead><tr>
            <th style={{ ...th, width: 70 }}>Categoría</th>
            <th style={th}>Descripción</th>
            <th style={{ ...th, width: 110 }}>Composición</th>
            <th style={{ ...th, width: 70 }}>Placement</th>
            <th style={{ ...th, width: 58 }}>Color</th>
            <th style={{ ...th, width: 54 }}>Consumo</th>
            <th style={{ ...th, width: 34 }}>UOM</th>
            <th style={{ ...th, width: 100 }}>Proveedor</th>
            <th style={{ ...th, width: 22 }} className="no-print"></th>
          </tr></thead>
          <tbody>
            {doc.bom.map(r => (
              <tr key={r.id}>
                <td style={td}><input style={ci} value={r.categoria} onChange={e => patchBom(r.id, { categoria: e.target.value })} /></td>
                <td style={td}><input style={ci} value={r.descripcion} onChange={e => patchBom(r.id, { descripcion: e.target.value })} /></td>
                <td style={td}><input style={ci} value={r.composicion} onChange={e => patchBom(r.id, { composicion: e.target.value })} /></td>
                <td style={td}><input style={ci} value={r.placement} onChange={e => patchBom(r.id, { placement: e.target.value })} /></td>
                <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0 4px' }}>{r.color ? <span style={{ width: 11, height: 11, borderRadius: 2, background: r.color, border: '1px solid #999', flexShrink: 0 }} /> : null}<input style={{ ...ci, padding: '5px 2px' }} value={r.color} onChange={e => patchBom(r.id, { color: e.target.value })} /></div></td>
                <td style={td}><input style={ci} value={r.consumo} onChange={e => patchBom(r.id, { consumo: e.target.value })} /></td>
                <td style={td}><input style={{ ...ci, textAlign: 'center' }} value={r.uom} onChange={e => patchBom(r.id, { uom: e.target.value })} /></td>
                <td style={td}><input style={ci} value={r.proveedor} onChange={e => patchBom(r.id, { proveedor: e.target.value })} /></td>
                <td style={{ ...td, textAlign: 'center' }} className="no-print"><button onClick={() => removeBom(r.id)} style={delBtn}><Trash2 size={11} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="no-print" onClick={addBom} style={addRowBtn}><Plus size={11} /> Agregar fila</button>
      </div>
    )
  }

  function renderColorways() {
    return project.colors && project.colors.length > 0 ? (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {project.colors.map((c, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ width: 70, height: 70, background: c, border: '1px solid #999', borderRadius: 6 }} />
            <div style={{ fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>{c}</div>
          </div>
        ))}
      </div>
    ) : <div style={{ fontSize: 11, color: '#888' }}>Sin colores definidos en el diseño.</div>
  }

  function renderNotes(p: TechPackPage) {
    return (
      <textarea value={p.body} onChange={e => patchPage(p.id, { body: e.target.value })} placeholder="Observaciones para el taller…"
        style={{ width: '100%', height: '100%', minHeight: 360, border: '1px solid #ddd', borderRadius: 6, padding: 12, fontSize: 12, fontFamily: 'Arial', resize: 'none', color: '#111', background: '#fff', boxSizing: 'border-box' }} />
    )
  }

}

// ─── sub-componentes ───────────────────────────────────────────────────────────
function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid ' + (active ? 'var(--accent)' : 'transparent'),
      background: active ? 'color-mix(in oklch, var(--accent) 16%, transparent)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--fg-2)', cursor: 'pointer', padding: 0,
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >{children}</button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#333' }}>{children}</div>
}

function MetaField({ label, value, onChange, w }: { label: string; value: string; onChange: (v: string) => void; w: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999' }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ width: w, border: 'none', borderBottom: '1px solid #ccc', outline: 'none', fontSize: 11, padding: '2px 0', color: '#111', background: 'transparent' }} />
    </label>
  )
}

function SortablePageItem({ page, index, Icon, active, onSelect, onDelete, total }: {
  page: TechPackPage; index: number; total: number; Icon: LucideIcon; active: boolean; onSelect: () => void; onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 5 : 'auto',
  }
  return (
    <div ref={setNodeRef} style={style} onClick={onSelect}
      className={undefined}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '8px 8px', borderRadius: 8, cursor: 'pointer',
        background: active ? 'color-mix(in oklch, var(--accent) 12%, var(--bg))' : 'var(--surface)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line-soft)'),
      }}>
        <span {...attributes} {...listeners} title="Arrastrá para reordenar" style={{ cursor: 'grab', color: 'var(--muted)', display: 'flex' }} onClick={e => e.stopPropagation()}>
          <GripVertical size={13} />
        </span>
        <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--fg-2)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title}</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>{index + 1}</span>
        {total > 1 && (
          <button onClick={e => { e.stopPropagation(); onDelete() }} title="Quitar página" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 1 }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

const btnTiny: React.CSSProperties = { fontSize: 9, padding: '3px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#111', display: 'inline-flex', alignItems: 'center', gap: 4 }
const addRowBtn: React.CSSProperties = { marginTop: 7, fontSize: 10, padding: '4px 10px', border: '1px dashed #bbb', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#333', display: 'inline-flex', alignItems: 'center', gap: 4 }
const delBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#c00', display: 'inline-flex', alignItems: 'center', padding: 2 }
