import React, { useEffect, useRef, useState, type RefObject } from 'react'
import * as fabric from 'fabric'
import { Project, TechPackMeasures } from '../types/project'
import { SYSTEM_FONTS, GOOGLE_FONTS, loadGoogleFont, loadUserFont, restoreUserFonts, deleteUserFont } from '../utils/fonts'
import './EditorScreen.css'

interface EditorActions { save: () => void; export: () => void; importImage: (f: File) => void; placeImage: (f: File) => void; techpack: () => void }

interface Props {
  project: Project
  designer: string
  onSave: (thumbnail: string, canvasJson: string) => void
  saved: boolean
  onSaveComplete: () => void
  onActionsReady: (a: EditorActions | null) => void
  onOpenTechPack: (snapshot: string, measures: TechPackMeasures | null) => void
  onToast?: (msg: string) => void
}

type Tool = 'select' | 'pencil' | 'pen' | 'curve' | 'eraser' | 'fill' | 'text' | 'eyedropper'
  | 'rect' | 'ellipse' | 'line' | 'hand' | 'zoom'

// Estilo de trazado especial aplicable a lo que se dibuja con lápiz / pluma
type StrokeStyle = 'normal' | 'bordado' | 'cierre'

type HistoryEntry =
  | { type: 'add';    obj: fabric.FabricObject }
  | { type: 'remove'; obj: fabric.FabricObject }
  | { type: 'fill';    obj: fabric.FabricObject; prevFill: fabric.TFiller | string | null }
  | { type: 'fillBatch'; items: { obj: fabric.FabricObject; prevFill: fabric.TFiller | string | null }[] }
  | { type: 'opacity'; obj: fabric.FabricObject; prevOpacity: number }
  | { type: 'modify'; prev: fabric.FabricObject; next: fabric.FabricObject }
  | { type: 'erase';  removed: fabric.FabricObject[]; added: fabric.FabricObject[] }
  | { type: 'group';   children: fabric.FabricObject[]; group: fabric.Group }
  | { type: 'ungroup'; children: fabric.FabricObject[]; group: fabric.Group }
  | { type: 'transform'; items: { obj: fabric.FabricObject; left: number; top: number }[] }

function catmullRomToBezier(pts: fabric.Point[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    // Centripetal Catmull-Rom (alpha=0.5): never overshoots or loops at sharp corners
    const d0 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y))
    const d1 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y))
    const d2 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y))
    let cp1x: number, cp1y: number, cp2x: number, cp2y: number
    if (d0 < 1e-4 || d1 < 1e-4) {
      cp1x = p1.x + (p2.x - p1.x) / 3; cp1y = p1.y + (p2.y - p1.y) / 3
    } else {
      const tx = d1 * ((p1.x - p0.x) / d0 - (p2.x - p0.x) / (d0 + d1) + (p2.x - p1.x) / d1)
      const ty = d1 * ((p1.y - p0.y) / d0 - (p2.y - p0.y) / (d0 + d1) + (p2.y - p1.y) / d1)
      cp1x = p1.x + tx / 3; cp1y = p1.y + ty / 3
    }
    if (d2 < 1e-4 || d1 < 1e-4) {
      cp2x = p2.x + (p1.x - p2.x) / 3; cp2y = p2.y + (p1.y - p2.y) / 3
    } else {
      const tx = d1 * ((p2.x - p1.x) / d1 - (p3.x - p1.x) / (d1 + d2) + (p3.x - p2.x) / d2)
      const ty = d1 * ((p2.y - p1.y) / d1 - (p3.y - p1.y) / (d1 + d2) + (p3.y - p2.y) / d2)
      cp2x = p2.x - tx / 3; cp2y = p2.y - ty / 3
    }
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`
  }
  return d
}

function straightPathStr(pts: fabric.Point[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// Bordado de satén: recorre la polilínea a paso fijo y en cada paso dibuja una
// puntada corta cruzada al trazo, alternando la diagonal — emula el relleno
// denso y texturado de un bordado real. Devuelve un único path con muchos
// subtrazos "M..L.." para que sea un solo objeto (un paso de historial).
function satinStitchPathStr(pts: fabric.Point[], width: number): string {
  const spacing = Math.max(1.6, width * 0.42)   // separación entre puntadas
  const half    = Math.max(2, width * 0.95)      // medio largo de cada puntada
  const skew     = 0.35                            // inclinación de satén
  const segs: string[] = []
  let carry = 0
  let flip  = 1
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const segLen = Math.hypot(dx, dy)
    if (segLen < 1e-3) continue
    const ux = dx / segLen, uy = dy / segLen      // tangente unitaria
    const nx = -uy, ny = ux                        // normal unitaria
    let d = carry
    while (d < segLen) {
      const cx = a.x + ux * d, cy = a.y + uy * d
      // puntada cruzada, ligeramente inclinada (alterna lado para el satén)
      const sx = (nx + ux * skew * flip), sy = (ny + uy * skew * flip)
      const sl = Math.hypot(sx, sy) || 1
      const ex = (sx / sl) * half, ey = (sy / sl) * half
      segs.push(`M ${cx - ex} ${cy - ey} L ${cx + ex} ${cy + ey}`)
      flip = -flip
      d += spacing
    }
    carry = d - segLen
  }
  return segs.join(' ')
}

// Cierre (cremallera): banda central + dientes alternados a cada lado, como los
// eslabones de un cierre. También devuelve un único path multi-trazo.
function zipperPathStr(pts: fabric.Point[], width: number): string {
  const spacing = Math.max(2.6, width * 0.7)    // separación entre dientes
  const half    = Math.max(2, width * 0.85)      // medio ancho de la banda
  const tooth   = Math.max(1.2, width * 0.5)     // largo del diente hacia afuera
  const segs: string[] = []
  // 1) dos rieles paralelos (líneas centrales del cierre)
  const railL: string[] = [], railR: string[] = []
  let flip = 1, carry = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const segLen = Math.hypot(dx, dy)
    if (segLen < 1e-3) continue
    const ux = dx / segLen, uy = dy / segLen
    const nx = -uy, ny = ux                        // normal unitaria
    // rieles a media distancia del eje
    const rh = half * 0.45
    railL.push(`${i === 0 ? 'M' : 'L'} ${a.x + nx * rh} ${a.y + ny * rh}`)
    railR.push(`${i === 0 ? 'M' : 'L'} ${a.x - nx * rh} ${a.y - ny * rh}`)
    if (i === pts.length - 2) {
      railL.push(`L ${b.x + nx * rh} ${b.y + ny * rh}`)
      railR.push(`L ${b.x - nx * rh} ${b.y - ny * rh}`)
    }
    // 2) dientes: un trazo corto perpendicular, alternando lado
    let d = carry
    while (d < segLen) {
      const cx = a.x + ux * d, cy = a.y + uy * d
      const inner = half * 0.1
      const outer = half * 0.1 + tooth
      segs.push(`M ${cx + nx * inner * flip} ${cy + ny * inner * flip} L ${cx + nx * outer * flip} ${cy + ny * outer * flip}`)
      flip = -flip
      d += spacing
    }
    carry = d - segLen
  }
  return [railL.join(' '), railR.join(' '), ...segs].join(' ')
}

// Muestrea puntos densos a lo largo de un path de Fabric (comandos M/L/Q/C),
// para poder reestilizar curvas (de la pluma) como puntos de una polilínea.
function samplePathCommands(path: any[], step = 4): fabric.Point[] {
  const out: fabric.Point[] = []
  let cx = 0, cy = 0, sx = 0, sy = 0
  const push = (x: number, y: number) => {
    const last = out[out.length - 1]
    if (!last || Math.hypot(x - last.x, y - last.y) >= step * 0.5) out.push(new fabric.Point(x, y))
  }
  const sampleC = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const approx = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)
    const n = Math.max(2, Math.ceil(approx / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n, mt = 1 - t
      const x = mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3
      const y = mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3
      push(x, y)
    }
  }
  const sampleQ = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    const approx = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(2, Math.ceil(approx / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n, mt = 1 - t
      const x = mt*mt*x0 + 2*mt*t*x1 + t*t*x2
      const y = mt*mt*y0 + 2*mt*t*y1 + t*t*y2
      push(x, y)
    }
  }
  for (const c of path) {
    const cmd = c[0]
    if (cmd === 'M')      { cx = sx = c[1]; cy = sy = c[2]; push(cx, cy) }
    else if (cmd === 'L') { cx = c[1]; cy = c[2]; push(cx, cy) }
    else if (cmd === 'Q') { sampleQ(cx, cy, c[1], c[2], c[3], c[4]); cx = c[3]; cy = c[4] }
    else if (cmd === 'C') { sampleC(cx, cy, c[1], c[2], c[3], c[4], c[5], c[6]); cx = c[5]; cy = c[6] }
    else if (cmd === 'Z') { push(sx, sy); cx = sx; cy = sy }
  }
  return out
}

// Datos del trazado especial a partir de una polilínea de puntos.
function specialStrokeData(pts: fabric.Point[], style: StrokeStyle, width: number): { d: string; sw: number } | null {
  if (style === 'bordado') return { d: satinStitchPathStr(pts, width), sw: Math.max(1.4, width * 0.34) }
  if (style === 'cierre')  return { d: zipperPathStr(pts, width),      sw: Math.max(1.2, width * 0.3) }
  return null
}

// Ramer-Douglas-Peucker: reduce puntos manteniendo la forma
function perpDist(p: fabric.Point, a: fabric.Point, b: fabric.Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function rdp(pts: fabric.Point[], epsilon: number): fabric.Point[] {
  if (pts.length <= 2) return pts
  let maxD = 0, maxI = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; maxI = i }
  }
  if (maxD > epsilon) {
    const L = rdp(pts.slice(0, maxI + 1), epsilon)
    const R = rdp(pts.slice(maxI), epsilon)
    return [...L.slice(0, -1), ...R]
  }
  return [pts[0], pts[pts.length - 1]]
}

const PEN_CURSOR     = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cpath d='M2 18 L5 10 L14 1 L19 6 L10 15 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M2 18 L5 10 L10 15 Z' fill='%23aaa'/%3E%3C/svg%3E") 2 18, crosshair`
const PEN_DEL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M2 18 L5 10 L14 1 L19 6 L10 15 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M2 18 L5 10 L10 15 Z' fill='%23aaa'/%3E%3Ccircle cx='18' cy='4' r='4.5' fill='%23dd0000'/%3E%3Crect x='15.5' y='3' width='5' height='2' rx='1' fill='white'/%3E%3C/svg%3E") 2 18, crosshair`
const PEN_ADD_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M2 18 L5 10 L14 1 L19 6 L10 15 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M2 18 L5 10 L10 15 Z' fill='%23aaa'/%3E%3Ccircle cx='18' cy='4' r='4.5' fill='%231D77E0'/%3E%3Crect x='15.5' y='3' width='5' height='2' rx='1' fill='white'/%3E%3Crect x='17' y='1.5' width='2' height='5' rx='1' fill='white'/%3E%3C/svg%3E") 2 18, crosshair`
const CURVE_CURSOR   = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M2 18 L5 10 L14 1 L19 6 L10 15 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M2 18 L5 10 L10 15 Z' fill='%23aaa'/%3E%3Cpath d='M14 2 Q16 0.5 17.5 2 Q19 3.5 21 2' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round'/%3E%3C/svg%3E") 2 18, crosshair`

// ── Nombres legibles de las piezas del mockup ────────────────────────────────
// El id del elemento en el SVG (body, sleeve-left, hood…) se traduce a una etiqueta
// que ve el diseñador. Si no hay id conocido, cae en "Pieza N".
const PIECE_LABELS: Record<string, string> = {
  body: 'Cuerpo', cuerpo: 'Cuerpo', torso: 'Cuerpo', front: 'Frente', back: 'Espalda',
  'sleeve-left': 'Manga L', 'sleeve-right': 'Manga R', 'sleeve_l': 'Manga L', 'sleeve_r': 'Manga R',
  sleeve: 'Manga', mangal: 'Manga L', mangar: 'Manga R',
  hood: 'Capucha', 'hood-inner': 'Capucha int.', capucha: 'Capucha',
  pocket: 'Bolsillo', bolsillo: 'Bolsillo', collar: 'Cuello', cuello: 'Cuello',
  cuff: 'Puño', 'cuff-left': 'Puño L', 'cuff-right': 'Puño R', hem: 'Ruedo', waistband: 'Cintura',
  waist: 'Cintura', 'leg-left': 'Pierna L', 'leg-right': 'Pierna R', leg: 'Pierna',
}
function pieceLabelFromId(id: string | undefined | null, fallback: string): string {
  if (!id) return fallback
  const key = id.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '')
  if (PIECE_LABELS[key]) return PIECE_LABELS[key]
  // ids con sufijo numérico o variantes: "sleeve-left-2", "hood2" → match por prefijo
  const sorted = Object.keys(PIECE_LABELS).sort((a, b) => b.length - a.length)
  for (const k of sorted) if (key.startsWith(k)) return PIECE_LABELS[k]
  return fallback
}
function pieceNameOf(obj: fabric.FabricObject, fallback = 'Pieza'): string {
  return ((obj as any)._pieceName as string) || fallback
}
const GARMENT_NAMES: Record<string, string> = { tshirt: 'Remera', hoodie: 'Hoodie', pants: 'Pantalón' }

// ── Anchor editing helpers ────────────────────────────────────────────────────
const ANCHOR_R   = 5
const ANCHOR_HIT = 11

type AnchorHandle = {
  circle: fabric.Circle
  kind: 'path' | 'line'
  cmdIdx: number
  coordsIdx: number
  endpoint?: 1 | 2
}

function isDrawnPathOrLine(obj: fabric.FabricObject): boolean {
  return (obj as any).type === 'path' || (obj as any).type === 'line'
}

// Convierte coordenadas locales de un objeto Fabric a coordenadas canvas,
// teniendo en cuenta el pathOffset que Fabric.js usa para normalizar paths.
function localToCanvas(obj: fabric.FabricObject, lx: number, ly: number): fabric.Point {
  const po  = (obj as any).pathOffset as { x: number; y: number } | undefined
  const mat = obj.calcTransformMatrix()
  return fabric.util.transformPoint({ x: lx - (po?.x ?? 0), y: ly - (po?.y ?? 0) }, mat)
}


function buildAnchorHandles(obj: fabric.FabricObject, canvas: fabric.Canvas): AnchorHandle[] {
  const out: AnchorHandle[] = []

  if ((obj as any).type === 'line') {
    const line = obj as fabric.Line
    const eps = [
      { x: line.x1 as number, y: line.y1 as number, endpoint: 1 as const },
      { x: line.x2 as number, y: line.y2 as number, endpoint: 2 as const },
    ]
    eps.forEach(({ x, y, endpoint }) => {
      const p = localToCanvas(obj, x, y)
      const circle = new fabric.Circle({
        left: p.x - ANCHOR_R, top: p.y - ANCHOR_R,
        radius: ANCHOR_R, fill: '#fff', stroke: '#1D77E0', strokeWidth: 2,
        selectable: false, evented: false, originX: 'left', originY: 'top',
      })
      canvas.add(circle)
      out.push({ circle, kind: 'line', cmdIdx: -1, coordsIdx: -1, endpoint })
    })
  } else {
    const path = obj as fabric.Path
    ;(path.path as any[][]).forEach((cmd, cmdIdx) => {
      const c = cmd[0] as string
      let lx: number, ly: number, coordsIdx: number
      if      (c === 'M' || c === 'L') { lx = cmd[1]; ly = cmd[2]; coordsIdx = 1 }
      else if (c === 'C')               { lx = cmd[5]; ly = cmd[6]; coordsIdx = 5 }
      else return
      const p = localToCanvas(obj, lx, ly)
      const circle = new fabric.Circle({
        left: p.x - ANCHOR_R, top: p.y - ANCHOR_R,
        radius: ANCHOR_R, fill: '#fff', stroke: '#1D77E0', strokeWidth: 2,
        selectable: false, evented: false, originX: 'left', originY: 'top',
      })
      canvas.add(circle)
      out.push({ circle, kind: 'path', cmdIdx, coordsIdx })
    })
  }
  canvas.requestRenderAll()
  return out
}

function clearAnchorHandles(handles: AnchorHandle[], canvas: fabric.Canvas) {
  handles.forEach(h => canvas.remove(h.circle))
  handles.length = 0
}

function getAnchorPositions(obj: fabric.FabricObject): fabric.Point[] {
  if ((obj as any).type === 'line') {
    const l = obj as fabric.Line
    return [localToCanvas(obj, l.x1 as number, l.y1 as number), localToCanvas(obj, l.x2 as number, l.y2 as number)]
  }
  return ((obj as fabric.Path).path as any[][]).flatMap(cmd => {
    const c = cmd[0] as string
    if (c === 'M' || c === 'L') return [localToCanvas(obj, cmd[1], cmd[2])]
    if (c === 'C')               return [localToCanvas(obj, cmd[5], cmd[6])]
    return []
  })
}

function rebuildFromAnchors(
  old: fabric.FabricObject,
  pts: fabric.Point[],
  canvas: fabric.Canvas,
  undoHistory: React.MutableRefObject<HistoryEntry[]>,
  clip: fabric.Group | null,
  forceSmooth?: boolean,
): fabric.FabricObject | null {
  canvas.remove(old)
  if (pts.length < 2) {
    undoHistory.current.push({ type: 'remove', obj: old })
    return null
  }
  const hasSmooth = forceSmooth ?? ((old as any).path
    ? ((old as fabric.Path).path as any[][]).some(c => c[0] === 'C')
    : false)
  const hoverCur = (old as any).hoverCursor as string | undefined
  let newObj: fabric.FabricObject
  if (pts.length === 2) {
    const [p0, p1] = pts
    const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2
    const len   = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI
    newObj = new fabric.Line([-len / 2, 0, len / 2, 0], {
      left: cx, top: cy, angle, originX: 'center', originY: 'center',
      stroke: old.stroke as string, strokeWidth: old.strokeWidth,
      strokeLineCap: (old.strokeLineCap ?? 'round') as string,
      fill: undefined, selectable: false, evented: true, clipPath: clip ?? undefined,
    })
  } else {
    const d = hasSmooth ? catmullRomToBezier(pts) : straightPathStr(pts)
    newObj = new fabric.Path(d, {
      stroke: old.stroke as string, strokeWidth: old.strokeWidth,
      strokeLineCap: (old.strokeLineCap ?? 'round') as string,
      strokeLineJoin: (old.strokeLineJoin ?? 'round') as string,
      fill: (old.fill as string | null) ?? null,
      selectable: false, evented: true, clipPath: clip ?? undefined,
      strokeUniform: true,
    })
  }
  if (hoverCur) (newObj as any).hoverCursor = hoverCur
  canvas.add(newObj)
  undoHistory.current.push({ type: 'modify', prev: old, next: newObj })
  return newObj
}

// Reconstruye un path mezclando segmentos rectos (corners) y curvas suaves.
// Usa Catmull-Rom centripetal (alpha=0.5) para anchors suaves: garantiza sin overshoots
// ni loops incluso en curvas muy cerradas, con C1 continuidad en los anchors suaves.
// Anchors esquina (corner) reciben handles en dirección del chord (1/3 de longitud),
// dando una transición natural sin cúspide.
function buildMixedPath(positions: fabric.Point[], smoothAnchors: Set<number>, closed = false): string {
  const n = positions.length
  if (n < 2) return ''

  let d = `M ${positions[0].x} ${positions[0].y}`
  const segments = closed ? n : n - 1

  for (let j = 0; j < segments; j++) {
    const j1    = (j + 1) % n
    const Pj    = positions[j]
    const Pj1   = positions[j1]
    const s0    = smoothAnchors.has(j)
    const s1    = smoothAnchors.has(j1)

    if (!s0 && !s1) { d += ` L ${Pj1.x} ${Pj1.y}`; continue }

    const jPrev  = j   === 0     ? (closed ? n - 1 : 0)     : j   - 1
    const j1Next = j1  === n - 1 ? (closed ? 0     : n - 1) : j1  + 1
    const pPrev  = positions[jPrev]
    const pNext  = positions[j1Next]

    // Centripetal (alpha=0.5) chord lengths
    const d0 = Math.sqrt(Math.hypot(Pj.x  - pPrev.x, Pj.y  - pPrev.y))
    const d1 = Math.sqrt(Math.hypot(Pj1.x - Pj.x,    Pj1.y - Pj.y))
    const d2 = Math.sqrt(Math.hypot(pNext.x - Pj1.x,  pNext.y - Pj1.y))

    let cp1x: number, cp1y: number
    if (!s0 || d0 < 1e-4 || d1 < 1e-4) {
      // corner or degenerate endpoint → chord-direction handle (1/3 along chord)
      cp1x = Pj.x + (Pj1.x - Pj.x) / 3
      cp1y = Pj.y + (Pj1.y - Pj.y) / 3
    } else {
      // Centripetal tangent at Pj (outgoing), scaled to d1
      const tx = d1 * ((Pj.x - pPrev.x) / d0 - (Pj1.x - pPrev.x) / (d0 + d1) + (Pj1.x - Pj.x) / d1)
      const ty = d1 * ((Pj.y - pPrev.y) / d0 - (Pj1.y - pPrev.y) / (d0 + d1) + (Pj1.y - Pj.y) / d1)
      cp1x = Pj.x + tx / 3
      cp1y = Pj.y + ty / 3
    }

    let cp2x: number, cp2y: number
    if (!s1 || d2 < 1e-4 || d1 < 1e-4) {
      // corner or degenerate endpoint → chord-direction handle (1/3 along chord)
      cp2x = Pj1.x + (Pj.x - Pj1.x) / 3
      cp2y = Pj1.y + (Pj.y - Pj1.y) / 3
    } else {
      // Centripetal tangent at Pj1 (incoming), scaled to d1
      const tx = d1 * ((Pj1.x - Pj.x) / d1 - (pNext.x - Pj.x) / (d1 + d2) + (pNext.x - Pj1.x) / d2)
      const ty = d1 * ((Pj1.y - Pj.y) / d1 - (pNext.y - Pj.y) / (d1 + d2) + (pNext.y - Pj1.y) / d2)
      cp2x = Pj1.x - tx / 3
      cp2y = Pj1.y - ty / 3
    }

    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${Pj1.x} ${Pj1.y}`
  }
  if (closed) d += ' Z'
  return d
}

// Distancia de un punto a un segmento de línea
function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Devuelve el índice (en positions) donde insertar un nuevo anclaje, o -1 si no está cerca
function nearPathSegmentIdx(obj: fabric.FabricObject, pt: fabric.Point, threshold: number): number {
  const positions = getAnchorPositions(obj)
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i], b = positions[i + 1]
    if (distPointToSegment(pt.x, pt.y, a.x, a.y, b.x, b.y) < threshold) return i + 1
  }
  return -1
}

// ── Helpers De Casteljau para inserción correcta en paths bezier ─────────────
function lerpPt(a: fabric.Point, b: fabric.Point, t: number): fabric.Point {
  return new fabric.Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

// Subdivide una cúbica bezier en t usando De Casteljau.
// Retorna [left_cp1, left_cp2, midPt, right_cp1, right_cp2]
function splitCubicAt(
  p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, p1: fabric.Point, t: number,
): [fabric.Point, fabric.Point, fabric.Point, fabric.Point, fabric.Point] {
  const q0 = lerpPt(p0,  cp1, t), q1 = lerpPt(cp1, cp2, t), q2 = lerpPt(cp2, p1,  t)
  const r0 = lerpPt(q0,  q1,  t), r1 = lerpPt(q1,  q2,  t)
  const s  = lerpPt(r0,  r1,  t)
  return [q0, r0, s, r1, q2]
}

// Punto más cercano sobre una cúbica bezier. Retorna t ∈ [0,1] y distancia.
function nearestOnCubic(
  p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, p1: fabric.Point,
  target: fabric.Point,
): { t: number; dist: number } {
  let bestT = 0, bestD = Infinity
  const N = 64
  for (let i = 0; i <= N; i++) {
    const t = i / N, mt = 1 - t
    const x = mt*mt*mt*p0.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*p1.x
    const y = mt*mt*mt*p0.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*p1.y
    const d = Math.hypot(x - target.x, y - target.y)
    if (d < bestD) { bestD = d; bestT = t }
  }
  return { t: bestT, dist: bestD }
}

// Encuentra el segmento de un path bezier (BCmd[]) más cercano al punto dado.
// Retorna { cmdIdx, t, dist } o null si nada está dentro del threshold.
type BCmd = { type: string; pts: fabric.Point[] }
function findNearestBezierSeg(
  cmds: BCmd[], target: fabric.Point, threshold: number,
): { cmdIdx: number; t: number; dist: number } | null {
  let best: { cmdIdx: number; t: number; dist: number } | null = null
  for (let ci = 1; ci < cmds.length; ci++) {
    const cmd     = cmds[ci]
    const prevPt  = cmds[ci - 1].pts[cmds[ci - 1].pts.length - 1]
    let dist: number, t: number
    if (cmd.type === 'C') {
      const r = nearestOnCubic(prevPt, cmd.pts[0], cmd.pts[1], cmd.pts[2], target)
      dist = r.dist; t = r.t
    } else if (cmd.type === 'L') {
      const dx = cmd.pts[0].x - prevPt.x, dy = cmd.pts[0].y - prevPt.y
      const len2 = dx * dx + dy * dy
      t = len2 > 0 ? Math.max(0, Math.min(1, ((target.x - prevPt.x) * dx + (target.y - prevPt.y) * dy) / len2)) : 0
      dist = distPointToSegment(target.x, target.y, prevPt.x, prevPt.y, cmd.pts[0].x, cmd.pts[0].y)
    } else continue
    if (dist < threshold && (!best || dist < best.dist)) best = { cmdIdx: ci, t, dist }
  }
  return best
}

// Inserta un ancla en un BCmd[] usando De Casteljau y retorna el nuevo array de cmds.
function insertIntoBezierCmds(cmds: BCmd[], cmdIdx: number, t: number): BCmd[] {
  const out = cmds.map(c => ({ type: c.type, pts: c.pts.map(p => new fabric.Point(p.x, p.y)) }))
  const cmd    = cmds[cmdIdx]
  const prevPt = cmds[cmdIdx - 1].pts[cmds[cmdIdx - 1].pts.length - 1]
  if (cmd.type === 'C') {
    const [lcp1, lcp2, mid, rcp1, rcp2] = splitCubicAt(prevPt, cmd.pts[0], cmd.pts[1], cmd.pts[2], t)
    out.splice(cmdIdx, 1,
      { type: 'C', pts: [lcp1, lcp2, mid]  },
      { type: 'C', pts: [rcp1, rcp2, cmd.pts[2]] },
    )
  } else if (cmd.type === 'L') {
    const mid = new fabric.Point(
      prevPt.x + t * (cmd.pts[0].x - prevPt.x),
      prevPt.y + t * (cmd.pts[0].y - prevPt.y),
    )
    out.splice(cmdIdx, 1,
      { type: 'L', pts: [mid] },
      { type: 'L', pts: [cmd.pts[0]] },
    )
  }
  return out
}

function bezierCmdsToPathStr(cmds: BCmd[]): string {
  return cmds.map(c =>
    c.type === 'Z' ? 'Z' : c.type + ' ' + c.pts.map(p => `${p.x} ${p.y}`).join(' ')
  ).join(' ')
}

// Extrae los comandos de un path Fabric como BCmd[] en coordenadas canvas
function extractBezierCmds(obj: fabric.FabricObject): BCmd[] {
  return ((obj as fabric.Path).path as any[][]).map(cmd => {
    const c = cmd[0] as string
    if (c === 'M' || c === 'L') return { type: c, pts: [localToCanvas(obj, cmd[1], cmd[2])] }
    if (c === 'C') return { type: 'C', pts: [
      localToCanvas(obj, cmd[1], cmd[2]),
      localToCanvas(obj, cmd[3], cmd[4]),
      localToCanvas(obj, cmd[5], cmd[6]),
    ]}
    return { type: c, pts: [] }
  })
}

// ── Eraser math ─────────────────────────────────────────────────────────────

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3
}

function splitCubic2(
  p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, p1: fabric.Point, t: number
): [[fabric.Point, fabric.Point, fabric.Point, fabric.Point], [fabric.Point, fabric.Point, fabric.Point, fabric.Point]] {
  const lp = (a: fabric.Point, b: fabric.Point, u: number) => new fabric.Point(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)
  const m1 = lp(p0, cp1, t), m2 = lp(cp1, cp2, t), m3 = lp(cp2, p1, t)
  const m4 = lp(m1, m2, t),  m5 = lp(m2, m3, t),   m6 = lp(m4, m5, t)
  return [[p0, m1, m4, m6], [m6, m5, m3, p1]]
}

function subBezier(
  p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, p1: fabric.Point, t0: number, t1: number
): [fabric.Point, fabric.Point, fabric.Point, fabric.Point] {
  let piece: [fabric.Point, fabric.Point, fabric.Point, fabric.Point] = [p0, cp1, cp2, p1]
  if (t0 > 1e-9)  piece = splitCubic2(...piece, t0)[1]
  if (t1 < 1-1e-9) piece = splitCubic2(...piece, (t1 - t0) / (1 - t0))[0]
  return piece
}

function findCircleCrossings(
  p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, p1: fabric.Point,
  cx: number, cy: number, r: number
): number[] {
  const SAMPLES = 48, r2 = r * r
  const f = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 - r2
  const ts: number[] = []
  let prev = f(p0.x, p0.y)
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const cur = f(cubicAt(p0.x, cp1.x, cp2.x, p1.x, t), cubicAt(p0.y, cp1.y, cp2.y, p1.y, t))
    if (prev * cur < 0) {
      let lo = (i - 1) / SAMPLES, hi = t
      for (let j = 0; j < 20; j++) {
        const m = (lo + hi) / 2
        const fm = f(cubicAt(p0.x, cp1.x, cp2.x, p1.x, m), cubicAt(p0.y, cp1.y, cp2.y, p1.y, m))
        if (fm * prev > 0) lo = m; else hi = m
      }
      ts.push((lo + hi) / 2)
    }
    if (cur !== 0) prev = cur
  }
  return ts
}

// Cuts exact bezier sub-segments using findCircleCrossings + subBezier.
// Returns null  → eraser doesn't touch any centerline (skip remove/re-add entirely).
// Returns []    → entire path is inside the eraser (delete it).
// Returns [...] → SVG path strings for each surviving fragment.
function eraseCircleFromPath(path: fabric.Path, cx: number, cy: number, r: number): string[] | null {
  const cmds = extractBezierCmds(path)
  if (!cmds.length) return null

  const r2 = r * r
  type SubSeg = [fabric.Point, fabric.Point, fabric.Point, fabric.Point]
  const fragments: SubSeg[][] = []
  let current: SubSeg[] = []
  let anyErased = false
  let prev = new fabric.Point(0, 0)
  let subpathStart = new fabric.Point(0, 0)

  const breakFragment = () => {
    if (current.length > 0) { fragments.push(current); current = [] }
  }

  // Processes one bezier segment (p0→endPt via cp1,cp2) against the eraser
  const processSegment = (p0: fabric.Point, cp1: fabric.Point, cp2: fabric.Point, endPt: fabric.Point) => {
    const crossings = findCircleCrossings(p0, cp1, cp2, endPt, cx, cy, r)
    if (crossings.length === 0) {
      if ((p0.x - cx) ** 2 + (p0.y - cy) ** 2 < r2) { anyErased = true; breakFragment() }
      else { current.push([p0, cp1, cp2, endPt]) }
      return
    }
    anyErased = true
    const ts: number[] = [0, ...crossings.sort((a, b) => a - b), 1]
    const cleanTs: number[] = [ts[0]]
    for (let i = 1; i < ts.length; i++)
      if (ts[i] - cleanTs[cleanTs.length - 1] > 1e-6) cleanTs.push(ts[i])
    for (let i = 0; i < cleanTs.length - 1; i++) {
      const t0 = cleanTs[i], t1 = cleanTs[i + 1]
      const mx = cubicAt(p0.x, cp1.x, cp2.x, endPt.x, (t0 + t1) / 2)
      const my = cubicAt(p0.y, cp1.y, cp2.y, endPt.y, (t0 + t1) / 2)
      if ((mx - cx) ** 2 + (my - cy) ** 2 < r2) breakFragment()
      else current.push(subBezier(p0, cp1, cp2, endPt, t0, t1))
    }
  }

  for (const cmd of cmds) {
    if (cmd.type === 'Z') {
      // Expand Z → explicit line from prev back to subpath start so this edge can be erased too
      if (Math.hypot(prev.x - subpathStart.x, prev.y - subpathStart.y) > 0.5) {
        const ep = subpathStart
        processSegment(prev,
          new fabric.Point(prev.x + (ep.x - prev.x) / 3, prev.y + (ep.y - prev.y) / 3),
          new fabric.Point(prev.x + 2 * (ep.x - prev.x) / 3, prev.y + 2 * (ep.y - prev.y) / 3),
          ep)
      }
      breakFragment()
      prev = subpathStart
      continue
    }
    if (cmd.type === 'M') { breakFragment(); subpathStart = cmd.pts[0]; prev = cmd.pts[0]; continue }

    const p0 = prev
    let cp1: fabric.Point, cp2: fabric.Point, endPt: fabric.Point
    if (cmd.type === 'L') {
      endPt = cmd.pts[0]
      cp1 = new fabric.Point(p0.x + (endPt.x - p0.x) / 3, p0.y + (endPt.y - p0.y) / 3)
      cp2 = new fabric.Point(p0.x + 2 * (endPt.x - p0.x) / 3, p0.y + 2 * (endPt.y - p0.y) / 3)
    } else {
      cp1 = cmd.pts[0]; cp2 = cmd.pts[1]; endPt = cmd.pts[2]
    }
    prev = endPt
    processSegment(p0, cp1, cp2, endPt)
  }

  breakFragment()
  if (!anyErased) return null

  return fragments
    .filter(f => f.length > 0)
    .map(segs => {
      let d = `M ${segs[0][0].x} ${segs[0][0].y}`
      for (const [sp0, scp1, scp2, sp1] of segs)
        d += ` C ${scp1.x} ${scp1.y} ${scp2.x} ${scp2.y} ${sp1.x} ${sp1.y}`
      return d
    })
}

// ── Illustrator-style selection controls ────────────────────────────────────
// Defined at module level so hot-reload re-applies them instantly (useEffect
// only runs on mount and would be stale after HMR).
const SEL_BLUE  = '#1256C8'   // darker AI-like blue
const SEL_H     = 6           // handle visual size in screen px

function renderAIHandle(ctx: CanvasRenderingContext2D, left: number, top: number) {
  const x = Math.round(left - SEL_H / 2) + 0.5
  const y = Math.round(top  - SEL_H / 2) + 0.5
  const s = SEL_H - 1
  ctx.save()
  ctx.fillStyle   = '#ffffff'
  ctx.fillRect(x, y, s, s)
  ctx.strokeStyle = SEL_BLUE
  ctx.lineWidth   = 1
  ctx.strokeRect(x, y, s, s)
  ctx.restore()
}

Object.assign(fabric.FabricObject.ownDefaults, {
  borderColor:        SEL_BLUE,
  borderScaleFactor:  1,
  cornerSize:         SEL_H + 4,
  cornerStyle:        'rect',
  transparentCorners: false,   // false = Fabric also draws white fill as fallback
  cornerColor:        '#ffffff',
  cornerStrokeColor:  SEL_BLUE,
  perPixelTargetFind: true,    // solo selecciona/agarra sobre la figura real, no sobre la caja invisible
  targetFindTolerance: 4,      // pequeño margen para que el trazo fino siga siendo fácil de agarrar
})
fabric.FabricObject.prototype.padding = 0
try {
  const _c = fabric.FabricObject.prototype.controls
  Object.keys(_c).forEach(k => {
    _c[k].render = k === 'mtr' ? (() => {}) as any : renderAIHandle as any
  })
} catch (_) {}
// En multiselección Fabric dibuja el borde de CADA objeto + el del grupo. Sobreescribimos
// para mostrar SOLO el recuadro englobante (los trazos los marca nuestro overlay aparte).
try {
  ;(fabric.ActiveSelection.prototype as any)._renderControls = function (ctx: CanvasRenderingContext2D, styleOverride: any) {
    ctx.save()
    ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1
    ;(fabric.FabricObject.prototype as any)._renderControls.call(this, ctx, styleOverride)
    ctx.restore()
  }
} catch (_) {}
// ────────────────────────────────────────────────────────────────────────────

const EYEDROPPER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M15 2 L20 7 L9 18 L6 21 L1 16 L12 5 Z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M15 2 L20 7 L17 10 L12 5 Z' fill='%23ccc'/%3E%3Crect x='3' y='14' width='4' height='4' rx='1' fill='%23555'/%3E%3C/svg%3E") 2 20, crosshair`

// Lápiz: punta abajo-izquierda, borrador arriba-derecha
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect x='8' y='1' width='5' height='12' rx='1' fill='%23f5c842' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='8,13 13,13 10.5,18' fill='%23e8a87c' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='9.5,16.5 11.5,16.5 10.5,18' fill='%23222'/%3E%3Crect x='8' y='1' width='5' height='3' rx='1' fill='%23bbb' stroke='%23333' stroke-width='1'/%3E%3C/svg%3E") 10 18, crosshair`


// Campo numérico con flechitas propias (no las nativas del navegador) y soporte para valor
// "Mixto": cuando hay selección múltiple con valores distintos muestra el indicador y las
// flechas quedan deshabilitadas, pero igual se puede escribir un número para igualarlos a todos.
function NumberField({
  value, onChange, min, max, step = 1, mixed = false, suffix, width = 56, fullWidth = false,
}: {
  value: number
  onChange: (n: number) => void
  min?: number; max?: number; step?: number
  mixed?: boolean
  suffix?: string
  width?: number
  fullWidth?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) => {
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    return n
  }
  const shown = draft != null ? draft : (mixed ? '' : String(value))
  const commit = (raw: string) => { const n = parseFloat(raw); if (!isNaN(n)) onChange(clamp(n)); setDraft(null) }
  const stepBy = (d: number) => { if (mixed) return; onChange(clamp((value ?? 0) + d)) }
  const btn: React.CSSProperties = {
    width: 16, height: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 'none', background: 'transparent', cursor: mixed ? 'default' : 'pointer',
    color: mixed ? 'var(--muted-2)' : 'var(--muted)', lineHeight: 0,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: fullWidth ? '100%' : undefined }}>
      <div style={{ position: 'relative', width: fullWidth ? '100%' : width }}>
        <input
          type="text" inputMode="decimal"
          value={shown}
          placeholder={mixed ? '—' : ''}
          onChange={e => { setDraft(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(clamp(n)) }}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
            else if (e.key === 'ArrowUp')   { e.preventDefault(); stepBy(step) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-step) }
          }}
          style={{
            width: '100%', padding: '5px 20px 5px 8px', borderRadius: 6, textAlign: 'right', boxSizing: 'border-box',
            background: 'var(--surface)', border: '1px solid var(--line)',
            color: 'var(--fg)', fontFamily: 'var(--mono)', fontSize: 12,
          }}
        />
        <div style={{ position: 'absolute', right: 2, top: 1, bottom: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <button type="button" tabIndex={-1} disabled={mixed} aria-label="Aumentar"
            onMouseDown={e => e.preventDefault()} onClick={() => stepBy(step)} style={btn}>
            <svg width="9" height="6" viewBox="0 0 9 6"><path d="M1 4.5 L4.5 1 L8 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" tabIndex={-1} disabled={mixed} aria-label="Disminuir"
            onMouseDown={e => e.preventDefault()} onClick={() => stepBy(-step)} style={btn}>
            <svg width="9" height="6" viewBox="0 0 9 6"><path d="M1 1.5 L4.5 5 L8 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      {suffix && <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{suffix}</span>}
    </div>
  )
}

export default function EditorScreen({ project, onSave, saved, onSaveComplete, onActionsReady, onOpenTechPack, onToast }: Props) {
  const canvasEl      = useRef<HTMLCanvasElement>(null)
  const canvasAreaRef = useRef<HTMLElement>(null)
  const cursorRef     = useRef<HTMLDivElement>(null)
  const fontFileRef   = useRef<HTMLInputElement>(null)
  const fc            = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const clipPath      = useRef<fabric.Group | null>(null)
  const undoHistory   = useRef<HistoryEntry[]>([])
  const redoHistory   = useRef<HistoryEntry[]>([])
  const clipboardBuf  = useRef<fabric.FabricObject | null>(null)
  const colorRef      = useRef('#ff6b00')
  const brushSizeRef  = useRef(8)
  const strokeStyleRef = useRef<StrokeStyle>('normal')
  const fillRef       = useRef<string | null>(null)
  const fontFamilyRef = useRef('Arial')
  const isMouseDown   = useRef(false)
  const snapPoints    = useRef<fabric.Point[]>([])
  const clipEnabledRef = useRef(true)
  const mockupLockedRef = useRef(true)
  const measuresRef = useRef<Measures>(DEFAULT_MEASURES)
  const pxPerCmRef = useRef(0)
  const teeFitRef = useRef<{ sc: number; ox: number; oy: number } | null>(null)  // escala fija: el tamaño refleja los cm
  // Guías inteligentes (líneas magenta de alineación al arrastrar, como Illustrator)
  const smartGuides = useRef<{ v: { x: number; y1: number; y2: number } | null; h: { y: number; x1: number; x2: number } | null }>({ v: null, h: null })

  const [tool, setTool] = useState<Tool>('select')
  const [zoom,   setZoom]   = useState(1)
  const [panned, setPanned] = useState(false)
  const [rightTab,     setRightTab]     = useState<'props' | 'layers' | 'textures'>('props')
  // Ancho del panel de propiedades, redimensionable arrastrando su borde izquierdo (estilo Illustrator).
  const RIGHT_MIN = 200, RIGHT_MAX = 520
  const rightPanelRef = useRef<HTMLElement>(null)
  const [rightPanelW, setRightPanelW] = useState<number>(() => {
    const saved = Number(localStorage.getItem('raw.rightPanelW'))
    return saved >= RIGHT_MIN && saved <= RIGHT_MAX ? saved : 232
  })
  const [resizingPanel, setResizingPanel] = useState(false)
  // Arrastre del divisor: el ancho crece al mover el mouse hacia la izquierda.
  // Durante el arrastre cambiamos el ancho por DOM directo (sin setState por frame, así
  // no re-renderiza todo el editor ni parpadea el canvas). Al soltar, recién, persistimos.
  function startPanelResize(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightPanelRef.current?.offsetWidth ?? rightPanelW
    let finalW = startW
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setResizingPanel(true)
    const onMove = (ev: PointerEvent) => {
      finalW = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(startW + (startX - ev.clientX))))
      if (rightPanelRef.current) rightPanelRef.current.style.width = finalW + 'px'
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizingPanel(false)
      setRightPanelW(finalW)
      localStorage.setItem('raw.rightPanelW', String(finalW))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  // Paleta de color editable por textura + cuál textura tiene el editor abierto
  const [texColors, setTexColors] = useState<Record<TextureKind, string[]>>(() =>
    Object.fromEntries((Object.keys(TEXTURE_COLORS) as TextureKind[]).map(k => [k, defaultTexPalette(k)])) as Record<TextureKind, string[]>)
  const [activeTexKind, setActiveTexKind] = useState<TextureKind | null>(null)
  const [texAdvanced, setTexAdvanced] = useState(false)  // editor por-slot (avanzado) colapsado
  const [layers,       setLayers]       = useState<fabric.FabricObject[]>([])
  const [selectedObj,  setSelectedObj]  = useState<fabric.FabricObject | null>(null)

  const [hasSel,        setHasSel]        = useState(false)
  const [isText,        setIsText]        = useState(false)
  const [propFill,      setPropFill]      = useState<string | null>(null)
  const [propStroke,    setPropStroke]    = useState('#ff6b00')
  const [propSWidth,    setPropSWidth]    = useState(8)
  const [propSWidthMixed, setPropSWidthMixed] = useState(false)  // selección múltiple con grosores distintos
  const [strokeStyle,   setStrokeStyle]   = useState<StrokeStyle>('normal')  // trazado especial para lápiz/pluma
  const [propX,         setPropX]         = useState(0)
  const [propY,         setPropY]         = useState(0)
  const [propW,         setPropW]         = useState(0)
  const [propH,         setPropH]         = useState(0)
  const [propAngle,     setPropAngle]     = useState(0)
  const [propOpacity,    setPropOpacity]    = useState(100)
  const [propFontFamily, setPropFontFamily] = useState('Arial')
  const [propFontSize,  setPropFontSize]  = useState(24)
  const [userFonts,      setUserFonts]      = useState<string[]>([])
  const [fontPickerOpen, setFontPickerOpen] = useState(false)
  const [fontFilter,     setFontFilter]     = useState('')
  const [fontLoading,    setFontLoading]    = useState(false)
  const [vectorizing,    setVectorizing]    = useState(false)
  const [clipEnabled,    setClipEnabled]    = useState(true)
  const [layersVersion,  setLayersVersion]  = useState(0)  // bump to force layer-panel re-render on visibility/lock changes
  const [selKind,        setSelKind]        = useState<'none' | 'single' | 'multi' | 'group'>('none')
  const [ctxMenu,        setCtxMenu]        = useState<null | { x: number; y: number; target: fabric.FabricObject | null; isGroup: boolean; isMulti: boolean }>(null)
  const [mockupLocked,   setMockupLocked]   = useState(true)
  const [dragActive,     setDragActive]     = useState(false)
  const [measures,       setMeasures]       = useState<Measures>(DEFAULT_MEASURES)
  const [openGroups,     setOpenGroups]     = useState<Record<string, boolean>>({})  // grupos de medidas desplegados
  const [measureEdit,    setMeasureEdit]    = useState(false)  // tiradores de medida sobre el lienzo
  const measureEditRef = useRef(false)
  const isTee = project.mockupId === 'tshirt'
  useEffect(() => { measureEditRef.current = measureEdit }, [measureEdit])
  // Salir del modo tiradores si cambiás de herramienta o de pestaña
  useEffect(() => { if (tool !== 'select' || rightTab !== 'props') setMeasureEdit(false) }, [tool, rightTab])
  // Arrastre de los tiradores de medida
  useEffect(() => {
    const canvas = fc.current
    if (!canvas || !measureEdit || tool !== 'select') return
    const prevSkip = canvas.skipTargetFind, prevSel = canvas.selection
    canvas.skipTargetFind = true; canvas.selection = false; canvas.defaultCursor = 'pointer'
    let drag: (typeof TEE_HANDLES)[number] | null = null
    let raf: number | null = null
    let pend: { x: number; y: number } | null = null
    const hitR = () => 16 / (canvas.getZoom() || 1)
    const onDown = (e: any) => {
      const f = teeFitRef.current; if (!f) return
      const p = e.scenePoint; const W = teeWarp(measuresRef.current)
      // Agarra el handle MÁS CERCANO dentro del radio (no el primero), así dos handles
      // próximos (p. ej. pecho y manga en la axila) no se "roban" el click.
      let best = Infinity
      for (const h of TEE_HANDLES) {
        const [wx, wy] = W(h.base[0], h.base[1])
        const d = Math.hypot(p.x - (wx * f.sc + f.ox), p.y - (wy * f.sc + f.oy))
        if (d < hitR() && d < best) { best = d; drag = h }
      }
    }
    const apply = () => {
      raf = null
      const f = teeFitRef.current; if (!drag || !pend || !f) return
      const fld = MEASURE_FIELDS.find(ff => ff.key === drag!.key)!
      let v = drag.toMeasure((pend.x - f.ox) / f.sc, (pend.y - f.oy) / f.sc, measuresRef.current)
      v = Math.round(Math.min(fld.max, Math.max(fld.min, v)) * 10) / 10
      applyMeasures({ ...measuresRef.current, [drag.key]: v })
    }
    const onMove = (e: any) => { if (!drag) return; pend = e.scenePoint; if (raf === null) raf = requestAnimationFrame(apply) }
    const onUp = () => { drag = null }
    canvas.on('mouse:down', onDown); canvas.on('mouse:move', onMove); canvas.on('mouse:up', onUp)
    canvas.requestRenderAll()
    return () => {
      canvas.off('mouse:down', onDown); canvas.off('mouse:move', onMove); canvas.off('mouse:up', onUp)
      canvas.skipTargetFind = prevSkip; canvas.selection = prevSel; canvas.defaultCursor = 'default'
      if (raf) cancelAnimationFrame(raf)
      canvas.requestRenderAll()
    }
  }, [measureEdit, tool]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { clipEnabledRef.current = clipEnabled }, [clipEnabled])
  useEffect(() => { colorRef.current      = propStroke    }, [propStroke])
  useEffect(() => { brushSizeRef.current  = propSWidth    }, [propSWidth])
  useEffect(() => { strokeStyleRef.current = strokeStyle   }, [strokeStyle])
  useEffect(() => { fillRef.current       = propFill      }, [propFill])
  useEffect(() => { fontFamilyRef.current = propFontFamily }, [propFontFamily])
  useEffect(() => { restoreUserFonts().then(names => { if (names.length) setUserFonts(names) }) }, [])

  // Register save/export actions for ChromeBar
  useEffect(() => {
    const handleSaveRef = () => handleSave()
    const handleExportRef = () => handleExport()
    onActionsReady({ save: handleSaveRef, export: handleExportRef, importImage: handleImportPng, placeImage: handlePlaceImage, techpack: openTechPack })
    return () => onActionsReady(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Font picker handlers ─────────────────────────────────────────────────────
  async function handleFontSelect(family: string) {
    if ((GOOGLE_FONTS as readonly string[]).includes(family)) {
      setFontLoading(true)
      await loadGoogleFont(family)
      setFontLoading(false)
    }
    applyFontFamily(family)
    setFontPickerOpen(false)
    setFontFilter('')
  }

  async function handleFontUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const name = await loadUserFont(file)
    setUserFonts(prev => prev.includes(name) ? prev : [...prev, name])
    await handleFontSelect(name)
  }

  function handleDeleteUserFont(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    deleteUserFont(name)
    setUserFonts(prev => prev.filter(f => f !== name))
    if (propFontFamily === name) applyFontFamily('Arial')
  }

  // ── CSS cursor helpers ───────────────────────────────────────────────────────
  function showSizeCursor(clientX: number, clientY: number) {
    const div  = cursorRef.current
    const area = canvasAreaRef.current
    const cv   = canvasEl.current
    if (!div || !area || !cv) return
    const cvRect   = cv.getBoundingClientRect()
    const areaRect = area.getBoundingClientRect()
    const scale = cvRect.width / 600
    const r = brushSizeRef.current * scale
    div.style.left    = `${clientX - areaRect.left - r}px`
    div.style.top     = `${clientY - areaRect.top  - r}px`
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

    const area = canvasAreaRef.current
    const CW = area?.clientWidth  || 800
    const CH = area?.clientHeight || 600

    const canvas = new fabric.Canvas(canvasEl.current, {
      width: CW, height: CH,
      backgroundColor: '',
      selection: true,
      preserveObjectStacking: true,  // el objeto seleccionado mantiene su orden Z (no salta al frente)
    })
    fc.current = canvas

    // Mantener el canvas ajustado al área disponible (F11, Ctrl+/-, redimensionar ventana).
    // Se conserva el centro de lo que estabas mirando trasladando el viewport por la mitad
    // de la diferencia de tamaño — no destructivo (no mueve los objetos en escena).
    let ro: ResizeObserver | null = null
    if (area) {
      ro = new ResizeObserver(() => {
        const w = area.clientWidth, h = area.clientHeight
        const oldW = canvas.getWidth(), oldH = canvas.getHeight()
        if (!w || !h || (w === oldW && h === oldH)) return
        canvas.setDimensions({ width: w, height: h })
        const vpt = canvas.viewportTransform
        if (vpt) {
          vpt[4] += (w - oldW) / 2
          vpt[5] += (h - oldH) / 2
        }
        // Redibujado SINCRONO en el mismo frame: setDimensions vacía el bitmap del canvas
        // (al cambiar canvas.width). Si difiriéramos el render (requestRenderAll) se vería un
        // frame en blanco en cada paso del arrastre -> la prenda "titila". renderAll() lo evita.
        canvas.renderAll()
      })
      ro.observe(area)
    }

    const refreshLayers = () => setLayers([...canvas.getObjects()])
    // Enforce clip toggle on newly created objects (creation sites always set clipPath;
    // strip it when the user has clipping turned off so drawings show outside the shirt)
    canvas.on('object:added', (e: any) => {
      const o = e.target
      if (o && !mockupObjects.current.includes(o) && !clipEnabledRef.current) {
        o.clipPath = undefined
        o.dirty = true
      }
    })
    canvas.on('object:added',   refreshLayers)
    canvas.on('object:removed', refreshLayers)
    canvas.on('object:modified', refreshLayers)

    const syncSelKind = () => {
      const a = canvas.getActiveObject()
      if (!a) setSelKind('none')
      else if (a.type === 'activeselection') setSelKind('multi')
      else if (a.type === 'group')           setSelKind('group')
      else setSelKind('single')
    }
    canvas.on('selection:created', (e: any) => { setSelectedObj(e.selected?.[0] ?? null); syncSelKind() })
    canvas.on('selection:updated', (e: any) => { setSelectedObj(e.selected?.[0] ?? null); syncSelKind() })
    canvas.on('selection:cleared', () => { setSelectedObj(null); setSelKind('none') })

    // Illustrator-style path highlight: 1px blue stroke along the selected path(s)
    let hoverObj: fabric.FabricObject | null = null
    const onAfterRender = () => {
      const ctx = (canvas as any).contextContainer as CanvasRenderingContext2D
      if (!ctx) return
      const vpt = (canvas.viewportTransform ?? [1,0,0,1,0,0]) as number[]
      const rs = (canvas.getRetinaScaling?.() ?? 1)

      // Tiradores de medida (puntos arrastrables sobre la remera)
      if (measureEditRef.current && teeFitRef.current) {
        const { sc, ox, oy } = teeFitRef.current
        const W = teeWarp(measuresRef.current)
        ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0)
        for (const h of TEE_HANDLES) {
          const [wx, wy] = W(h.base[0], h.base[1])
          const scX = wx * sc + ox, scY = wy * sc + oy
          const cssX = vpt[0] * scX + vpt[2] * scY + vpt[4]
          const cssY = vpt[1] * scX + vpt[3] * scY + vpt[5]
          ctx.beginPath(); ctx.arc(cssX, cssY, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'; ctx.fill()
          ctx.lineWidth = 2; ctx.strokeStyle = SEL_BLUE; ctx.stroke()
          ctx.beginPath(); ctx.arc(cssX, cssY, 2, 0, Math.PI * 2); ctx.fillStyle = SEL_BLUE; ctx.fill()
        }
        ctx.restore()
      }

      // Guías inteligentes: líneas magenta de alineación mientras se arrastra (estilo Illustrator)
      const g = smartGuides.current
      if (g.v || g.h) {
        const toScr = (x: number, y: number) =>
          [vpt[0] * x + vpt[2] * y + vpt[4], vpt[1] * x + vpt[3] * y + vpt[5]] as const
        ctx.save(); ctx.setTransform(rs, 0, 0, rs, 0, 0)
        ctx.strokeStyle = '#ff3aa5'; ctx.lineWidth = 1
        if (g.v) { const [x1, y1] = toScr(g.v.x, g.v.y1), [x2, y2] = toScr(g.v.x, g.v.y2); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
        if (g.h) { const [x1, y1] = toScr(g.h.x1, g.h.y), [x2, y2] = toScr(g.h.x2, g.h.y); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
        ctx.restore()
      }

      // Dibuja el contorno (trazado) de un objeto en azul, sobre el canvas.
      const strokeOutline = (obj: fabric.FabricObject) => {
        const pathCmds = (obj as any).path as any[][] | undefined
        const T  = obj.calcTransformMatrix() as number[]
        if (pathCmds) {
          const po = (obj as fabric.Path).pathOffset ?? { x: 0, y: 0 }
          // Fabric renders: transform(calcTransformMatrix) → translate(-pathOffset) → draw path
          // So screen = vpt * T * (point - pathOffset); horneamos pathOffset en T.
          const t4 = T[0]*(-po.x) + T[2]*(-po.y) + T[4]
          const t5 = T[1]*(-po.x) + T[3]*(-po.y) + T[5]
          const ft = [
            vpt[0]*T[0] + vpt[2]*T[1], vpt[1]*T[0] + vpt[3]*T[1],
            vpt[0]*T[2] + vpt[2]*T[3], vpt[1]*T[2] + vpt[3]*T[3],
            vpt[0]*t4   + vpt[2]*t5   + vpt[4],
            vpt[1]*t4   + vpt[3]*t5   + vpt[5],
          ]
          const tp = (x: number, y: number) =>
            [ft[0]*x + ft[2]*y + ft[4], ft[1]*x + ft[3]*y + ft[5]] as const
          ctx.beginPath()
          for (const cmd of pathCmds) {
            switch (cmd[0]) {
              case 'M': case 'm': { const [px,py] = tp(cmd[1],cmd[2]); ctx.moveTo(px,py); break }
              case 'L': case 'l': { const [px,py] = tp(cmd[1],cmd[2]); ctx.lineTo(px,py); break }
              case 'C': case 'c': {
                const [x1,y1] = tp(cmd[1],cmd[2]), [x2,y2] = tp(cmd[3],cmd[4]), [x3,y3] = tp(cmd[5],cmd[6])
                ctx.bezierCurveTo(x1,y1,x2,y2,x3,y3); break
              }
              case 'Z': case 'z': ctx.closePath(); break
            }
          }
          ctx.stroke()
        } else {
          // Objetos sin path (rect, texto, etc.): contorno por sus 4 esquinas en coords de escena.
          const c = (obj as any).aCoords as { tl:any; tr:any; br:any; bl:any } | undefined
          if (!c) return
          const tp = (p: {x:number;y:number}) =>
            [vpt[0]*p.x + vpt[2]*p.y + vpt[4], vpt[1]*p.x + vpt[3]*p.y + vpt[5]] as const
          const [tlx,tly]=tp(c.tl), [trx,try_]=tp(c.tr), [brx,bry]=tp(c.br), [blx,bly]=tp(c.bl)
          ctx.beginPath(); ctx.moveTo(tlx,tly); ctx.lineTo(trx,try_); ctx.lineTo(brx,bry); ctx.lineTo(blx,bly); ctx.closePath(); ctx.stroke()
        }
      }

      const active = canvas.getActiveObjects()
      // Objeto bajo el mouse (hover): se resalta su trazado aunque no esté seleccionado.
      const hov = hoverObj
      const showHover = !!hov && hov.evented !== false && !active.includes(hov)
        && !mockupObjects.current.includes(hov) && canvas.getObjects().includes(hov)
      if (!active.length && !showHover) return
      ctx.save()
      ctx.setTransform(rs, 0, 0, rs, 0, 0)
      ctx.strokeStyle = SEL_BLUE
      ctx.lineWidth   = 1
      for (const obj of active) strokeOutline(obj)
      if (showHover) strokeOutline(hov!)
      ctx.restore()
    }
    canvas.on('after:render', onAfterRender)

    // Smart-highlight estilo Illustrator: al pasar el mouse por encima de un objeto se marca su
    // trazado. perPixelTargetFind hace que mouse:over solo dispare sobre la figura real.
    const onMouseOver = (e: any) => {
      const t = e.target as fabric.FabricObject | undefined
      if (!t || mockupObjects.current.includes(t)) { if (hoverObj) { hoverObj = null; canvas.requestRenderAll() } return }
      if (hoverObj !== t) { hoverObj = t; canvas.requestRenderAll() }
    }
    const onMouseOut = () => { if (hoverObj) { hoverObj = null; canvas.requestRenderAll() } }
    canvas.on('mouse:over', onMouseOver)
    canvas.on('mouse:out', onMouseOut)

    // ── Snapping + guías inteligentes (alineación al arrastrar, estilo Illustrator) ──
    const onObjMoving = (e: any) => {
      const obj = e.target as fabric.FabricObject | undefined
      if (!obj || mockupObjects.current.includes(obj)) return
      const thr = 7 / (canvas.getZoom() || 1)   // tolerancia en px de pantalla
      // Durante el arrastre Fabric mueve left/top pero NO recalcula aCoords hasta soltar,
      // así que getBoundingRect() daría la caja vieja. Forzamos setCoords para leer la actual.
      obj.setCoords()
      const b = obj.getBoundingRect()
      // candidatos: cajas de los otros objetos + caja de la remera (bordes y centros)
      const cands = canvas.getObjects()
        .filter(o => o !== obj && !mockupObjects.current.includes(o) && o.visible !== false && o.evented !== false)
        .map(o => o.getBoundingRect())
      const mb = mockupBounds(); if (mb) cands.push(mb as any)
      const mvX = [b.left, b.left + b.width / 2, b.left + b.width]
      const mvY = [b.top, b.top + b.height / 2, b.top + b.height]
      let bestX = { d: Infinity, x: 0, y1: 0, y2: 0 }
      let bestY = { d: Infinity, y: 0, x1: 0, x2: 0 }
      for (const c of cands) {
        const cXs = [c.left, c.left + c.width / 2, c.left + c.width]
        const cYs = [c.top, c.top + c.height / 2, c.top + c.height]
        for (const mx of mvX) for (const cx of cXs) {
          const d = cx - mx
          if (Math.abs(d) < Math.abs(bestX.d)) bestX = { d, x: cx, y1: Math.min(b.top, c.top), y2: Math.max(b.top + b.height, c.top + c.height) }
        }
        for (const my of mvY) for (const cy of cYs) {
          const d = cy - my
          if (Math.abs(d) < Math.abs(bestY.d)) bestY = { d, y: cy, x1: Math.min(b.left, c.left), x2: Math.max(b.left + b.width, c.left + c.width) }
        }
      }
      let snapped = false
      const guides: { v: { x: number; y1: number; y2: number } | null; h: { y: number; x1: number; x2: number } | null } = { v: null, h: null }
      if (Math.abs(bestX.d) <= thr) { obj.set({ left: (obj.left ?? 0) + bestX.d }); guides.v = { x: bestX.x, y1: bestX.y1, y2: bestX.y2 }; snapped = true }
      if (Math.abs(bestY.d) <= thr) { obj.set({ top: (obj.top ?? 0) + bestY.d }); guides.h = { y: bestY.y, x1: bestY.x1, x2: bestY.x2 }; snapped = true }
      if (snapped) obj.setCoords()
      smartGuides.current = guides
    }
    const clearGuides = () => {
      if (smartGuides.current.v || smartGuides.current.h) { smartGuides.current = { v: null, h: null }; canvas.requestRenderAll() }
    }
    canvas.on('object:moving', onObjMoving)
    canvas.on('object:modified', clearGuides)
    canvas.on('mouse:up', clearGuides)

    // Stroke width stays visually constant during scaling via strokeUniform:true on
    // every object — no manual strokeWidth mutation needed (that caused the bounding-box
    // to recompute mid-transform and made one-sided scaling jump). This matches Illustrator.

    // Marquee drag-selection box
    canvas.selectionColor       = 'rgba(18, 86, 200, 0.06)'
    canvas.selectionBorderColor = SEL_BLUE
    canvas.selectionLineWidth   = 1
    ;(canvas as any).selectionDashArray = []
    ;(canvas as any).uniformScaling     = false
    // Modificadores al escalar:
    //  - Shift = escalar SIMÉTRICO desde el centro (los dos lados crecen a la vez en ese eje).
    //    Si agarrás el tirador del medio de un lado, crece "para los dos lados" de ese eje.
    //  - Alt   = mantener proporción (lo que por defecto hacía Shift).
    ;(canvas as any).centeredKey = 'shiftKey'
    ;(canvas as any).uniScaleKey = 'altKey'
    canvas.skipOffscreen = false

    // Restaura objetos del usuario guardados y conecta path:created (común a ambos mockups)
    const restoreAndWire = async () => {
      if (project.canvasJson) {
        try {
          const saved = JSON.parse(project.canvasJson) as object[]
          const revived = await (fabric.util as any).enlivenObjects(saved) as fabric.FabricObject[]
          if (cancelled) return
          for (const obj of revived) {
            obj.set({ strokeUniform: true })
            if (!(obj instanceof fabric.IText) && clipPath.current) obj.set({ clipPath: clipPath.current })
            canvas.add(obj)
          }
        } catch (e) {
          console.warn('canvas restore failed', e)
        }
      }
      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (clipPath.current) e.path.clipPath = clipPath.current
        e.path.set({ selectable: false, evented: false })
        undoHistory.current.push({ type: 'add', obj: e.path })
        redoHistory.current = []
        canvas.renderAll()
      })
      canvas.renderAll()
    }

    if (PARAMETRIC_TEE && project.mockupId === 'tshirt') {
      // Remera paramétrica generada por medidas
      placeTee(measuresRef.current)
      restoreAndWire()
    } else {
      // Mockups SVG (hoodie, pants)
      const svgUrl = `/mockups/${project.mockupId}.svg`
      fabric.loadSVGFromURL(svgUrl).then(async ({ objects }) => {
        if (cancelled) return
        const objs = objects.filter(Boolean) as fabric.FabricObject[]
        mockupObjects.current = objs
        objs.forEach((obj, i) => {
          ;(obj as any)._rawMockup = true
          ;(obj as any)._pieceName = pieceLabelFromId((obj as any).id, `Pieza ${i + 1}`)
          obj.set({ selectable: false, evented: true, hoverCursor: 'crosshair' })
        })
        objs.forEach(obj => canvas.add(obj))

        const allL = objs.map(o => o.left ?? 0)
        const allT = objs.map(o => o.top  ?? 0)
        const allR = objs.map(o => (o.left ?? 0) + (o.width  ?? 0) * (o.scaleX ?? 1))
        const allB = objs.map(o => (o.top  ?? 0) + (o.height ?? 0) * (o.scaleY ?? 1))
        const bx = Math.min(...allL), by = Math.min(...allT)
        const bw = Math.max(...allR) - bx, bh = Math.max(...allB) - by
        const pad = Math.min(CW, CH) * 0.1
        const sc  = Math.min((CW - pad * 2) / bw, (CH - pad * 2) / bh)
        const ox  = (CW - bw * sc) / 2 - bx * sc
        const oy  = (CH - bh * sc) / 2 - by * sc
        objs.forEach(obj => {
          obj.set({
            left: (obj.left ?? 0) * sc + ox, top: (obj.top ?? 0) * sc + oy,
            scaleX: (obj.scaleX ?? 1) * sc, scaleY: (obj.scaleY ?? 1) * sc,
          })
          obj.setCoords()  // recalcula oCoords → el hit-test (click) ubica cada pieza
        })

        const { objects: clipRaw } = await fabric.loadSVGFromURL(svgUrl)
        if (cancelled) return
        const clipObjs = (clipRaw.filter(Boolean) as fabric.FabricObject[])
          .filter(obj => obj.fill && obj.fill !== 'none' && obj.fill !== '')
          .map(obj => { obj.set({ left: (obj.left ?? 0) * sc + ox, top: (obj.top ?? 0) * sc + oy, scaleX: (obj.scaleX ?? 1) * sc, scaleY: (obj.scaleY ?? 1) * sc }); return obj })
        const cg = new fabric.Group(clipObjs)
        cg.absolutePositioned = true
        clipPath.current = cg

        await restoreAndWire()
      })
    }

    return () => { cancelled = true; ro?.disconnect(); canvas.off('after:render', onAfterRender); canvas.off('mouse:over', onMouseOver); canvas.off('mouse:out', onMouseOut); canvas.dispose() }
  }, [project.mockupId])

  // ── Zoom (rueda) y pan (botón medio) ───────────────────────────────────────
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    const MIN_ZOOM = 0.25, MAX_ZOOM = 8

    const onWheel = (e: WheelEvent) => {
      const canvas = fc.current
      if (!canvas) return
      e.preventDefault()
      const zoom    = canvas.getZoom()
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(0.999, e.deltaY)))
      const pt      = canvas.getPointer(e as unknown as fabric.TPointerEvent, true)
      canvas.zoomToPoint(pt, newZoom)
      canvas.requestRenderAll()
      setZoom(newZoom)
    }

    let midPan = false
    let midLast = { x: 0, y: 0 }
    let spaceDown = false   // pan temporal con la barra espaciadora (como en Illustrator)

    const isTyping = () => {
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return true
      const c = fc.current
      const a = c?.getActiveObject()
      return a instanceof fabric.IText && (a as fabric.IText).isEditing
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping()) return
      e.preventDefault()
      if (!spaceDown) { spaceDown = true; if (!midPan) area.style.cursor = 'grab' }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceDown = false
      if (!midPan) area.style.cursor = ''
    }

    const onMDown = (e: MouseEvent) => {
      // Botón medio, o botón izquierdo con la barra espaciadora apretada → pan
      if (e.button !== 1 && !(e.button === 0 && spaceDown)) return
      e.preventDefault()
      e.stopPropagation()  // evita que la herramienta activa procese el clic
      midPan  = true
      midLast = { x: e.clientX, y: e.clientY }
      area.style.cursor = 'grabbing'
    }

    const onMMove = (e: MouseEvent) => {
      if (!midPan) return
      const canvas = fc.current
      if (!canvas) return
      const dx  = e.clientX - midLast.x
      const dy  = e.clientY - midLast.y
      midLast   = { x: e.clientX, y: e.clientY }
      const vpt = canvas.viewportTransform
      const w   = canvas.width  ?? 800
      const h   = canvas.height ?? 600
      const nx  = Math.min(w, Math.max(-w, vpt[4] + dx))
      const ny  = Math.min(h, Math.max(-h, vpt[5] + dy))
      canvas.relativePan(new fabric.Point(nx - vpt[4], ny - vpt[5]))
      canvas.requestRenderAll()
      setPanned(true)
    }

    const onMUp = (e: MouseEvent) => {
      if (!midPan) return
      if (e.button !== 1 && e.button !== 0) return
      midPan = false
      area.style.cursor = spaceDown ? 'grab' : ''
    }

    area  .addEventListener('wheel',     onWheel, { passive: false })
    area  .addEventListener('mousedown', onMDown,  { capture: true })
    window.addEventListener('mousemove', onMMove)
    window.addEventListener('mouseup',   onMUp)
    window.addEventListener('keydown',   onKeyDown)
    window.addEventListener('keyup',     onKeyUp)
    return () => {
      area  .removeEventListener('wheel',     onWheel)
      area  .removeEventListener('mousedown', onMDown, { capture: true })
      window.removeEventListener('mousemove', onMMove)
      window.removeEventListener('mouseup',   onMUp)
      window.removeEventListener('keydown',   onKeyDown)
      window.removeEventListener('keyup',     onKeyUp)
    }
  }, [])

  // ── Tool switching ──────────────────────────────────────────────────────────
  useEffect(() => {
    const _c = fc.current
    if (!_c) return
    const canvas: fabric.Canvas = _c

    canvas.isDrawingMode = false
    canvas.selection     = tool === 'select'
    canvas.discardActiveObject()
    const drawnHoverCursor = tool === 'pen' ? PEN_CURSOR : tool === 'curve' ? CURVE_CURSOR : tool === 'select' ? 'move' : 'default'
    canvas.getObjects().forEach(obj => {
      const isMockup = mockupObjects.current.includes(obj)
      const isIText  = obj instanceof fabric.IText
      const isLocked = !!(obj as any)._locked
      if (isLocked && !isMockup) {
        // Locked objects stay non-interactive regardless of the active tool
        obj.set({ selectable: false, evented: false })
        return
      }
      if (isMockup) {
        const unlocked = !mockupLockedRef.current
        obj.set({
          evented:    tool === 'fill' || (unlocked && (tool === 'select' || tool === 'curve')),
          selectable: unlocked && tool === 'select',
        })
        return
      }
      obj.set({
        evented:    tool === 'select' || tool === 'curve' || tool === 'pen' || (tool === 'text' && isIText),
        selectable: tool === 'select',
        hoverCursor: drawnHoverCursor,
        // El texto se selecciona por TODA la caja del renglon (como Illustrator): los espacios y
        // huecos entre letras tambien son seleccionables. El resto usa hit-test por pixel.
        perPixelTargetFind: !isIText,
      })
    })

    const offs: (() => void)[] = []

    // ── Lápiz (freehand → smooth bezier) ─────────────────────────────────────
    if (tool === 'pencil') {
      canvas.selection     = false
      canvas.defaultCursor = PENCIL_CURSOR

      let drawing = false
      let rawPts: fabric.Point[] = []
      let previewPath: fabric.Path | null = null

      const onDown = (e: fabric.TPointerEventInfo) => {
        drawing = true
        rawPts  = [e.scenePoint]
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        if (!drawing) return
        rawPts.push(e.scenePoint)

        // Actualizar preview cada 6 puntos para no saturar el render
        if (rawPts.length % 6 !== 0) return
        if (previewPath) canvas.remove(previewPath)
        previewPath = new fabric.Path(straightPathStr(rawPts), {
          stroke: colorRef.current,
          strokeWidth: brushSizeRef.current,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          fill: null,
          opacity: 0.45,
          selectable: false, evented: false,
        })
        canvas.add(previewPath)
        canvas.requestRenderAll()
      }

      const onUp = () => {
        if (!drawing) return
        drawing = false
        if (previewPath) { canvas.remove(previewPath); previewPath = null }
        if (rawPts.length < 2) { rawPts = []; return }

        // 1. Reducir puntos con RDP (epsilon según grosor)
        const epsilon = Math.max(2, brushSizeRef.current * 0.4)
        const simplified = rdp(rawPts, epsilon)

        // 2. Según el trazado elegido: normal (bezier suave) o especial (bordado/cierre)
        const special = specialStrokeData(simplified, strokeStyleRef.current, brushSizeRef.current)
        const obj = special
          ? new fabric.Path(special.d, {
              stroke: colorRef.current, strokeWidth: special.sw,
              strokeLineCap: 'round', fill: null,
              selectable: false, evented: false, strokeUniform: true,
            })
          : new fabric.Path(catmullRomToBezier(simplified), {
              stroke: colorRef.current, strokeWidth: brushSizeRef.current,
              strokeLineCap: 'round', strokeLineJoin: 'round', fill: null,
              selectable: false, evented: false, strokeUniform: true,
            })
        if (clipPath.current) obj.clipPath = clipPath.current
        canvas.add(obj)
        undoHistory.current.push({ type: 'add', obj })
        redoHistory.current = []
        rawPts = []
        canvas.requestRenderAll()
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up',   onUp)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up',   onUp)
        if (previewPath) canvas.remove(previewPath)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Pen (Illustrator-like bezier: click = corner, click+drag = smooth curve) ──
    if (tool === 'pen') {
      canvas.selection     = false
      canvas.defaultCursor = PEN_CURSOR
      hideSizeCursor()

      // ── Estado de edición de anclajes (paths existentes) ──
      let editObj: fabric.FabricObject | null = null
      let aHandles: AnchorHandle[] = []
      let selectedEditAnchorIdx: number | null = null

      const showAnchors = (obj: fabric.FabricObject) => {
        clearAnchorHandles(aHandles, canvas)
        editObj  = obj
        aHandles = buildAnchorHandles(obj, canvas)
        selectedEditAnchorIdx = null
      }

      const clearEdit = () => {
        clearAnchorHandles(aHandles, canvas)
        editObj = null
        selectedEditAnchorIdx = null
        canvas.requestRenderAll()
      }

      const deleteAnchor = (idx: number) => {
        if (!editObj) return
        const positions = getAnchorPositions(editObj)
        positions.splice(idx, 1)
        clearAnchorHandles(aHandles, canvas)
        aHandles = []
        const newObj = rebuildFromAnchors(editObj, positions, canvas, undoHistory, clipPath.current)
        editObj = newObj
        if (newObj) aHandles = buildAnchorHandles(newObj, canvas)
        redoHistory.current = []
        canvas.requestRenderAll()
      }

      // ── Estado de dibujo bezier ──
      // Cada ancla tiene: posición, handle de entrada (cp1) y handle de salida (cp2)
      type PAnchor = { pt: fabric.Point; cp1: fabric.Point; cp2: fabric.Point }
      const anchors: PAnchor[] = []
      let mouseIsDown    = false
      let draggingHandle = false
      let cursorPt       = new fabric.Point(0, 0)
      let isClosing      = false
      let lastClickTime  = 0
      let lastClickPos: fabric.Point | null = null
      const SNAP_RADIUS  = 14
      const ALIGN_THRESH = 8

      // Point snap (exact node) overrides alignment snap.
      // Alignment snap nudges X/Y independently toward shared axes with other anchors.
      const computeSnap = (raw: fabric.Point, candidates: fabric.Point[]): {
        snapped: fabric.Point
        nodeSnap: fabric.Point | null
        guides: Array<{ axis: 'h' | 'v'; val: number }>
      } => {
        for (const p of candidates) {
          if (Math.hypot(raw.x - p.x, raw.y - p.y) < SNAP_RADIUS)
            return { snapped: new fabric.Point(p.x, p.y), nodeSnap: p, guides: [] }
        }
        let sx = raw.x, sy = raw.y
        const guides: Array<{ axis: 'h' | 'v'; val: number }> = []
        // Include midpoints of all pairs so e.g. the apex of an equilateral triangle
        // snaps to the center X of the base automatically.
        const alignPts: Array<{ x: number; y: number }> = [...candidates]
        for (let i = 0; i < candidates.length; i++)
          for (let j = i + 1; j < candidates.length; j++)
            alignPts.push({ x: (candidates[i].x + candidates[j].x) / 2, y: (candidates[i].y + candidates[j].y) / 2 })
        let bestDx = ALIGN_THRESH + 1, bestDy = ALIGN_THRESH + 1
        for (const p of alignPts) {
          const dx = Math.abs(raw.x - p.x), dy = Math.abs(raw.y - p.y)
          if (dx < bestDx) { bestDx = dx; sx = p.x }
          if (dy < bestDy) { bestDy = dy; sy = p.y }
        }
        if (bestDx <= ALIGN_THRESH) guides.push({ axis: 'v', val: sx })
        if (bestDy <= ALIGN_THRESH) guides.push({ axis: 'h', val: sy })
        return { snapped: new fabric.Point(sx, sy), nodeSnap: null, guides }
      }

      // Todos los objetos temporales de visualización
      let tempObjs: fabric.FabricObject[] = []
      const clearTemp = () => { tempObjs.forEach(o => canvas.remove(o)); tempObjs = [] }
      const addTemp   = (o: fabric.FabricObject) => { tempObjs.push(o); canvas.add(o) }

      // Construye el SVG path desde los anclas bezier
      const buildPenPath = (ancs: PAnchor[], closeIt = false): string => {
        if (ancs.length === 0) return ''
        let d = `M ${ancs[0].pt.x} ${ancs[0].pt.y}`
        for (let i = 1; i < ancs.length; i++) {
          const prev = ancs[i - 1], curr = ancs[i]
          const straight = prev.cp2.x === prev.pt.x && prev.cp2.y === prev.pt.y
                        && curr.cp1.x === curr.pt.x && curr.cp1.y === curr.pt.y
          d += straight
            ? ` L ${curr.pt.x} ${curr.pt.y}`
            : ` C ${prev.cp2.x} ${prev.cp2.y} ${curr.cp1.x} ${curr.cp1.y} ${curr.pt.x} ${curr.pt.y}`
        }
        if (closeIt) {
          // The closing segment (last → first) must use bezier handles, not a bare Z.
          // A plain Z draws a straight line and ignores the handles at both endpoints,
          // causing a kink even when both adjacent segments are smooth curves.
          const last  = ancs[ancs.length - 1]
          const first = ancs[0]
          const closeStraight = last.cp2.x === last.pt.x && last.cp2.y === last.pt.y
                             && first.cp1.x === first.pt.x && first.cp1.y === first.pt.y
          if (!closeStraight)
            d += ` C ${last.cp2.x} ${last.cp2.y} ${first.cp1.x} ${first.cp1.y} ${first.pt.x} ${first.pt.y}`
          d += ' Z'
        }
        return d
      }

      // For each corner anchor (zero handles) that sits between two curved segments,
      // compute a smooth Catmull-Rom tangent so the path flows continuously through it.
      // Only runs on commit — doesn't mutate handles during interactive drawing.
      const autoSmoothCorners = (ancs: PAnchor[], closed: boolean): void => {
        const n = ancs.length
        if (n < 3) return
        for (let i = 0; i < n; i++) {
          const curr = ancs[i]
          if (curr.cp1.x !== curr.pt.x || curr.cp1.y !== curr.pt.y) continue
          if (curr.cp2.x !== curr.pt.x || curr.cp2.y !== curr.pt.y) continue
          if (!closed && (i === 0 || i === n - 1)) continue  // endpoints of open path

          const iPrev = (i - 1 + n) % n
          const iNext = (i + 1) % n
          const prev  = ancs[iPrev]
          const next  = ancs[iNext]

          // Adjacent segment is curved when the handle on THAT side is non-zero
          const prevCurved = prev.cp2.x !== prev.pt.x || prev.cp2.y !== prev.pt.y
          const nextCurved = next.cp1.x !== next.pt.x || next.cp1.y !== next.pt.y
          if (!prevCurved || !nextCurved) continue

          // Catmull-Rom tangent: direction prev→next, chord-length scaled (1/3 each side)
          const tx = next.pt.x - prev.pt.x
          const ty = next.pt.y - prev.pt.y
          const tLen = Math.hypot(tx, ty)
          if (tLen < 1e-9) continue
          const nx = tx / tLen, ny = ty / tLen

          const dIn  = Math.hypot(curr.pt.x - prev.pt.x, curr.pt.y - prev.pt.y)
          const dOut = Math.hypot(next.pt.x - curr.pt.x, next.pt.y - curr.pt.y)
          curr.cp1 = new fabric.Point(curr.pt.x - nx * dIn  / 3, curr.pt.y - ny * dIn  / 3)
          curr.cp2 = new fabric.Point(curr.pt.x + nx * dOut / 3, curr.pt.y + ny * dOut / 3)
        }
      }

      // Dibuja un brazo de handle (línea + circulito en el extremo)
      const drawArm = (from: fabric.Point, to: fabric.Point) => {
        if (from.x === to.x && from.y === to.y) return
        addTemp(new fabric.Line([from.x, from.y, to.x, to.y], {
          stroke: '#1D77E0', strokeWidth: 1, selectable: false, evented: false,
        }))
        addTemp(new fabric.Circle({
          left: to.x - 3, top: to.y - 3, radius: 3,
          fill: '#fff', stroke: '#1D77E0', strokeWidth: 1,
          selectable: false, evented: false,
        }))
      }

      // Redibuja todos los elementos visuales temporales
      const redraw = (
        cursor?: fabric.Point,
        liveCp2?: fabric.Point,
        guides: Array<{ axis: 'h' | 'v'; val: number }> = [],
        nodeSnap: fabric.Point | null = null,
      ) => {
        clearTemp()
        if (anchors.length === 0) { canvas.requestRenderAll(); return }

        // Relleno preview en tiempo real (igual que Illustrator: muestra el fill aunque el path esté abierto)
        const hasFill = fillRef.current !== null && fillRef.current !== ''
        if (hasFill && anchors.length >= 1) {
          let fillPathStr: string
          if (isClosing) {
            fillPathStr = buildPenPath(anchors, true)
          } else if (!mouseIsDown && cursor) {
            fillPathStr = buildPenPath(anchors) + ` L ${cursor.x} ${cursor.y} Z`
          } else {
            fillPathStr = buildPenPath(anchors) + ' Z'
          }
          addTemp(new fabric.Path(fillPathStr, {
            fill: fillRef.current, strokeWidth: 0,
            selectable: false, evented: false,
          }))
        }

        // Path comprometido hasta ahora (trazo)
        if (anchors.length >= 2) {
          const previewPathStr = buildPenPath(anchors)
          addTemp(new fabric.Path(previewPathStr, {
            stroke: colorRef.current, strokeWidth: brushSizeRef.current,
            strokeLineCap: previewPathStr.includes(' C ') ? 'round' : 'butt',
            strokeLineJoin: 'round',
            fill: null, selectable: false, evented: false,
          }))
        }

        // Handles y dots de cada ancla
        anchors.forEach((anc, i) => {
          addTemp(new fabric.Circle({
            left: anc.pt.x - 4, top: anc.pt.y - 4, radius: 4,
            fill: i === 0 && isClosing ? '#ff6b00' : colorRef.current,
            stroke: '#fff', strokeWidth: 1.5,
            selectable: false, evented: false,
          }))
          drawArm(anc.pt, anc.cp1)
          drawArm(anc.pt, anc.cp2)
        })

        // Handles en vivo mientras se arrastra el último ancla
        // Si Alt está activo, cp1 no es el mirror de cp2 — se dibuja el valor real de cp1
        if (liveCp2 && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          drawArm(last.pt, liveCp2)
          drawArm(last.pt, last.cp1)
        }

        // Preview del segmento al cursor (cuando no se está arrastrando)
        if (cursor && !mouseIsDown && anchors.length >= 1) {
          const last   = anchors[anchors.length - 1]
          const cp1out = last.cp2
          // When closing, use A0's incoming handle as the arriving control point so the
          // preview matches the smooth bezier that commit() will actually build.
          const cp2in: fabric.Point = isClosing && anchors.length >= 2
            ? anchors[0].cp1 : cursor
          const straight = cp1out.x === last.pt.x && cp1out.y === last.pt.y
                        && cp2in.x  === cursor.x  && cp2in.y  === cursor.y
          const seg = straight
            ? `M ${last.pt.x} ${last.pt.y} L ${cursor.x} ${cursor.y}`
            : `M ${last.pt.x} ${last.pt.y} C ${cp1out.x} ${cp1out.y} ${cp2in.x} ${cp2in.y} ${cursor.x} ${cursor.y}`
          addTemp(new fabric.Path(seg, {
            stroke: colorRef.current, strokeWidth: 1,
            strokeDashArray: [5, 4], opacity: 0.5,
            fill: null, selectable: false, evented: false,
          }))
        }

        // Indicador de cierre de path
        if (isClosing && anchors.length >= 2) {
          addTemp(new fabric.Circle({
            left: anchors[0].pt.x, top: anchors[0].pt.y,
            radius: 8, fill: 'transparent', stroke: '#ff6b00', strokeWidth: 1.5,
            originX: 'center', originY: 'center', selectable: false, evented: false,
          }))
        }

        // Alignment guide lines (H = constant Y, V = constant X)
        for (const g of guides) {
          const pts: [number, number, number, number] = g.axis === 'v'
            ? [g.val, -9999, g.val, 9999]
            : [-9999, g.val, 9999, g.val]
          addTemp(new fabric.Line(pts, {
            stroke: '#1D77E0', strokeWidth: 0.5, opacity: 0.5,
            strokeDashArray: [6, 4], selectable: false, evented: false,
          }))
          // Small crosshair dot at the snapped intersection
          if (cursor) {
            const gx = g.axis === 'v' ? g.val : cursor.x
            const gy = g.axis === 'h' ? g.val : cursor.y
            addTemp(new fabric.Circle({
              left: gx, top: gy, radius: 2.5, fill: '#1D77E0',
              originX: 'center', originY: 'center', selectable: false, evented: false,
            }))
          }
        }

        // Node snap ring for existing nodes (blue; orange ring already handles close-path)
        const isCloseNode = isClosing && anchors.length >= 2
          && nodeSnap !== null
          && nodeSnap.x === anchors[0].pt.x && nodeSnap.y === anchors[0].pt.y
        if (nodeSnap && !isCloseNode) {
          addTemp(new fabric.Circle({
            left: nodeSnap.x, top: nodeSnap.y, radius: 9,
            fill: 'transparent', stroke: '#1D77E0', strokeWidth: 1.5,
            originX: 'center', originY: 'center', selectable: false, evented: false,
          }))
        }

        canvas.requestRenderAll()
      }

      const commit = (closed = false) => {
        clearTemp()
        if (anchors.length >= 2) {
          snapPoints.current.push(new fabric.Point(anchors[0].pt.x, anchors[0].pt.y))
          const lastPt = anchors[anchors.length - 1].pt
          if (!closed) snapPoints.current.push(new fabric.Point(lastPt.x, lastPt.y))
          const penPathStr = buildPenPath(anchors, closed)
          // Trazado especial (bordado/cierre): muestreo la curva en puntos y la
          // reemplazo por las puntadas; si es normal, dejo el path tal cual.
          let special: { d: string; sw: number } | null = null
          if (strokeStyleRef.current !== 'normal') {
            const sampled = samplePathCommands((new fabric.Path(penPathStr)).path as any[], Math.max(3, brushSizeRef.current * 0.5))
            special = specialStrokeData(sampled, strokeStyleRef.current, brushSizeRef.current)
          }
          const obj = special
            ? new fabric.Path(special.d, {
                stroke: colorRef.current, strokeWidth: special.sw,
                strokeLineCap: 'round', fill: null,
                selectable: false, evented: true, strokeUniform: true,
              })
            : new fabric.Path(penPathStr, {
                stroke: colorRef.current, strokeWidth: brushSizeRef.current,
                strokeLineCap: penPathStr.includes(' C ') ? 'round' : 'butt',
                strokeLineJoin: 'round',
                fill: fillRef.current, selectable: false, evented: true,
                strokeUniform: true,
              })
          ;(obj as any).hoverCursor = PEN_CURSOR
          if (clipPath.current) obj.clipPath = clipPath.current
          canvas.add(obj)
          undoHistory.current.push({ type: 'add', obj })
          redoHistory.current = []
        }
        anchors.length = 0
        mouseIsDown = false; draggingHandle = false; isClosing = false
        canvas.requestRenderAll()
      }

      let penCursorCurrent = PEN_CURSOR
      const applyPenCursor = (cur: string) => {
        if (cur === penCursorCurrent) return
        penCursorCurrent = cur
        canvas.defaultCursor = cur
        canvas.getObjects().forEach(o => {
          if (!mockupObjects.current.includes(o)) (o as any).hoverCursor = cur
        })
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        const now   = Date.now()
        const rawPt = e.scenePoint

        // Snap the click position to nearby nodes / alignment axes
        const downCandidates = [...anchors.map(a => a.pt), ...snapPoints.current]
        const { snapped: pt } = computeSnap(rawPt, downCandidates)

        // Modo edición de anclajes (solo si no estamos dibujando)
        if (anchors.length === 0) {
          for (let i = 0; i < aHandles.length; i++) {
            const h = aHandles[i]
            const hx = (h.circle.left as number) + ANCHOR_R
            const hy = (h.circle.top  as number) + ANCHOR_R
            if (Math.hypot(pt.x - hx, pt.y - hy) < ANCHOR_HIT) {
              // Deselect previous
              if (selectedEditAnchorIdx !== null && aHandles[selectedEditAnchorIdx])
                aHandles[selectedEditAnchorIdx].circle.set({ fill: '#fff' })
              selectedEditAnchorIdx = i
              aHandles[i].circle.set({ fill: '#1D77E0' })
              canvas.requestRenderAll()
              return
            }
          }
          if (editObj) {
            const isBezier = !!(editObj as any).path
              && ((editObj as fabric.Path).path as any[][]).some((c: any[]) => c[0] === 'C')
            if (isBezier) {
              // Path bezier: De Casteljau para subdividir sin distorsionar la curva
              const bezierCmds = extractBezierCmds(editObj)
              const hit = findNearestBezierSeg(bezierCmds, pt, 12)
              if (hit) {
                const newCmds = insertIntoBezierCmds(bezierCmds, hit.cmdIdx, hit.t)
                const d = bezierCmdsToPathStr(newCmds)
                const oldClip = (editObj as any).clipPath as fabric.Group | undefined
                const newPath = new fabric.Path(d, {
                  stroke: editObj.stroke as string, strokeWidth: editObj.strokeWidth,
                  strokeLineCap: (editObj.strokeLineCap ?? 'round') as any,
                  strokeLineJoin: (editObj.strokeLineJoin ?? 'round') as any,
                  fill: (editObj.fill as string | null) ?? null,
                  selectable: false, evented: true, clipPath: oldClip,
                  strokeUniform: true,
                })
                ;(newPath as any).hoverCursor = PEN_CURSOR
                canvas.remove(editObj); canvas.add(newPath)
                undoHistory.current.push({ type: 'modify', prev: editObj, next: newPath })
                editObj = newPath
                clearAnchorHandles(aHandles, canvas)
                aHandles = buildAnchorHandles(newPath, canvas)
                redoHistory.current = []
                canvas.requestRenderAll()
                return
              }
            } else {
              // Path recto: inserción simple por distancia al segmento
              const insertIdx = nearPathSegmentIdx(editObj, pt, 8)
              if (insertIdx >= 0) {
                const positions = getAnchorPositions(editObj)
                positions.splice(insertIdx, 0, pt)
                clearAnchorHandles(aHandles, canvas); aHandles = []
                const newObj = rebuildFromAnchors(editObj, positions, canvas, undoHistory, clipPath.current)
                editObj = newObj
                if (newObj) aHandles = buildAnchorHandles(newObj, canvas)
                redoHistory.current = []
                canvas.requestRenderAll()
                return
              }
            }
          }
          const target = e.target
          if (target && !mockupObjects.current.includes(target) && isDrawnPathOrLine(target)) {
            showAnchors(target); return
          }
          clearEdit()
        }

        // Doble click → commit
        const isDbl = now - lastClickTime < 350
          && lastClickPos !== null
          && Math.hypot(pt.x - lastClickPos.x, pt.y - lastClickPos.y) < 10
        lastClickTime = now; lastClickPos = pt
        if (isDbl) { commit(); return }

        // Cerrar path si click en primer ancla
        if (anchors.length >= 2
          && Math.hypot(pt.x - anchors[0].pt.x, pt.y - anchors[0].pt.y) < SNAP_RADIUS) {
          commit(true); return
        }

        // Nuevo ancla (sin handles aún; se setean en mousemove si hay drag)
        mouseIsDown = true; draggingHandle = false
        anchors.push({
          pt:  new fabric.Point(pt.x, pt.y),
          cp1: new fabric.Point(pt.x, pt.y),
          cp2: new fabric.Point(pt.x, pt.y),
        })
        redraw(cursorPt)
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        const rawPt = e.scenePoint

        // Snap candidates: anchors of current path (minus the just-placed one if dragging)
        // + committed endpoints of other paths
        const moveCandidates: fabric.Point[] = [
          ...anchors.slice(0, mouseIsDown ? -1 : undefined).map(a => a.pt),
          ...snapPoints.current,
        ]

        // Compute snap only when not dragging a bezier handle (handles are free vectors)
        let snappedPt = rawPt
        let guides: Array<{ axis: 'h' | 'v'; val: number }> = []
        let nodeSnap: fabric.Point | null = null
        if (!draggingHandle) {
          const snap = computeSnap(rawPt, moveCandidates)
          snappedPt  = snap.snapped
          guides     = snap.guides
          nodeSnap   = snap.nodeSnap
        }
        cursorPt = snappedPt

        // Cursor dinámico en modo edición (usa rawPt para hit-test de handles)
        if (anchors.length === 0) {
          let overHandle = false
          for (const h of aHandles) {
            const hx = (h.circle.left as number) + ANCHOR_R
            const hy = (h.circle.top  as number) + ANCHOR_R
            if (Math.hypot(rawPt.x - hx, rawPt.y - hy) < ANCHOR_HIT) { overHandle = true; break }
          }
          const cur = overHandle ? PEN_CURSOR
            : (editObj && nearPathSegmentIdx(editObj, rawPt, 8) >= 0) ? PEN_ADD_CURSOR
            : PEN_CURSOR
          applyPenCursor(cur)
        }

        // Indicador de cierre (basado en posición snapeada)
        isClosing = anchors.length >= 2
          && Math.hypot(snappedPt.x - anchors[0].pt.x, snappedPt.y - anchors[0].pt.y) < SNAP_RADIUS

        // Arrastrar handle del último ancla (sin snap — dirección libre)
        // Alt = sólo mueve el handle de salida (cp2), cp1 queda fijo → ángulo asimétrico
        let liveCp2: fabric.Point | undefined
        if (mouseIsDown && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          if (Math.hypot(rawPt.x - last.pt.x, rawPt.y - last.pt.y) > 4) {
            draggingHandle = true
            last.cp2 = new fabric.Point(rawPt.x, rawPt.y)
            if (!(e.e as MouseEvent).altKey)
              last.cp1 = new fabric.Point(last.pt.x * 2 - rawPt.x, last.pt.y * 2 - rawPt.y)
            liveCp2 = last.cp2
          }
        }

        redraw(snappedPt, liveCp2, guides, nodeSnap)
      }

      const onUp = () => { mouseIsDown = false; draggingHandle = false; redraw(cursorPt) }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'Escape') commit()
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEditAnchorIdx !== null && anchors.length === 0) {
          e.preventDefault()
          const idx = selectedEditAnchorIdx
          selectedEditAnchorIdx = null
          deleteAnchor(idx)
        }
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up',   onUp)
      window.addEventListener('keydown', onKey)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up',   onUp)
        window.removeEventListener('keydown', onKey)
        canvas.defaultCursor = 'default'
        clearTemp()
        clearEdit()
        hideSizeCursor()
      })
    }

    // ── Curvatura: mueve anclas generando curvas suaves (Catmull-Rom siempre) ──
    if (tool === 'curve') {
      canvas.selection     = false
      canvas.defaultCursor = CURVE_CURSOR
      hideSizeCursor()

      let editObj: fabric.FabricObject | null = null
      let aHandles: AnchorHandle[] = []
      let draggingIdx: number | null = null
      let dragging = false
      let preDragObj: fabric.FabricObject | null = null
      // null = modo global (catmullRomToBezier); Set = modo mixto (buildMixedPath local)
      let smoothAnchors: Set<number> | null = null
      let selectedAnchorIdx: number | null = null

      // Al editar una pieza del mockup, el path se reconstruye: hay que mantener su
      // identidad de mockup (para que siga bloqueable y no quede huérfano al regenerar).
      const inheritMockup = (oldO: fabric.FabricObject, newO: fabric.FabricObject) => {
        if ((oldO as any)._rawMockup) {
          ;(newO as any)._rawMockup = true
          const idx = mockupObjects.current.indexOf(oldO)
          if (idx >= 0) mockupObjects.current[idx] = newO
          canvas.sendObjectToBack(newO)  // el mockup va al fondo, no encima de lo dibujado
        }
      }

      const setSelectedAnchor = (idx: number | null) => {
        if (selectedAnchorIdx !== null && aHandles[selectedAnchorIdx]) {
          aHandles[selectedAnchorIdx].circle.set({ fill: '#fff' })
        }
        selectedAnchorIdx = idx
        if (idx !== null && aHandles[idx]) {
          aHandles[idx].circle.set({ fill: '#1D77E0' })
        }
      }

      const deleteAnchorAt = (idx: number) => {
        if (!editObj) return
        const positions = getAnchorPositions(editObj)
        if (positions.length <= 2) {
          undoHistory.current.push({ type: 'remove', obj: editObj })
          canvas.remove(editObj)
          clearAnchorHandles(aHandles, canvas); aHandles = []
          editObj = null; selectedAnchorIdx = null
          redoHistory.current = []
          canvas.requestRenderAll()
          return
        }
        positions.splice(idx, 1)
        if (smoothAnchors !== null) {
          const ns = new Set<number>()
          for (const si of smoothAnchors) {
            if (si < idx) ns.add(si)
            else if (si > idx) ns.add(si - 1)
          }
          smoothAnchors = ns
        }
        const isClosed = !!(editObj as any).path &&
          ((editObj as fabric.Path).path as any[][]).some((c: any[]) => c[0] === 'Z')
        const oldClip = (editObj as any).clipPath as fabric.Group | undefined
        let pathStr: string
        if (positions.length === 2) {
          pathStr = `M ${positions[0].x} ${positions[0].y} L ${positions[1].x} ${positions[1].y}`
        } else if (smoothAnchors !== null) {
          pathStr = buildMixedPath(positions, smoothAnchors, isClosed)
        } else {
          pathStr = catmullRomToBezier(positions)
          if (isClosed) pathStr += ' Z'
        }
        const newPath = new fabric.Path(pathStr, {
          stroke: editObj.stroke as string, strokeWidth: editObj.strokeWidth,
          strokeLineCap: (editObj.strokeLineCap ?? 'round') as any,
          strokeLineJoin: (editObj.strokeLineJoin ?? 'round') as any,
          fill: (editObj.fill as string | null) ?? null,
          selectable: false, evented: true, clipPath: oldClip,
          strokeUniform: true,
        })
        if (smoothAnchors !== null) (newPath as any).__smoothAnchors = Array.from(smoothAnchors)
        ;(newPath as any).hoverCursor = CURVE_CURSOR
        undoHistory.current.push({ type: 'modify', prev: editObj, next: newPath })
        canvas.remove(editObj); canvas.add(newPath)
        inheritMockup(editObj, newPath)
        editObj = newPath
        clearAnchorHandles(aHandles, canvas); aHandles = []
        selectedAnchorIdx = null
        aHandles = buildAnchorHandles(newPath, canvas)
        redoHistory.current = []
        canvas.requestRenderAll()
      }

      const clearEdit = () => {
        clearAnchorHandles(aHandles, canvas)
        editObj = null; draggingIdx = null; dragging = false
        smoothAnchors = null; selectedAnchorIdx = null
        canvas.requestRenderAll()
      }

      // Reads existing SVG commands and marks each anchor as smooth (has non-degenerate
      // control point) or corner (cp == anchor position → zero-length handle).
      const detectSmoothAnchors = (cmds: any[][]): Set<number> => {
        const smooth = new Set<number>()
        const isClosed = cmds.some((c: any[]) => c[0] === 'Z')
        const segCmds = cmds.filter((c: any[]) => c[0] !== 'M' && c[0] !== 'Z')
        const mCmd = cmds.find((c: any[]) => c[0] === 'M')!
        const anchor0x = mCmd[1] as number, anchor0y = mCmd[2] as number

        // For closed paths the last segCmd loops back to anchor 0 — don't count it as a new anchor.
        let anchorCount = segCmds.length + 1
        if (isClosed && segCmds.length > 0) {
          const last = segCmds[segCmds.length - 1]
          const lastX = last[last.length - 2] as number, lastY = last[last.length - 1] as number
          if (Math.abs(lastX - anchor0x) < 0.5 && Math.abs(lastY - anchor0y) < 0.5) anchorCount--
        }

        for (let i = 0; i < segCmds.length; i++) {
          const c = segCmds[i]
          if (c[0] !== 'C') continue
          const fromIdx = i
          const toIdx = (i + 1) % anchorCount
          let ax: number, ay: number
          if (fromIdx === 0) { ax = anchor0x; ay = anchor0y }
          else { const p = segCmds[fromIdx - 1]; ax = p[p.length - 2] as number; ay = p[p.length - 1] as number }
          const [, cp1x, cp1y, cp2x, cp2y, px, py] = c as number[]
          if (Math.hypot(cp1x - ax, cp1y - ay) > 0.5) smooth.add(fromIdx)
          if (Math.hypot(cp2x - px, cp2y - py) > 0.5) smooth.add(toIdx)
        }
        return smooth
      }

      const showAnchors = (obj: fabric.FabricObject) => {
        clearAnchorHandles(aHandles, canvas)
        editObj  = obj
        aHandles = buildAnchorHandles(obj, canvas)
        selectedAnchorIdx = null
        const stored = (obj as any).__smoothAnchors
        if (stored) {
          smoothAnchors = new Set(stored as number[])
        } else if ((obj as any).path) {
          smoothAnchors = detectSmoothAnchors((obj as fabric.Path).path as any[][])
        } else {
          smoothAnchors = null
        }
      }

      // Reconstruye el path desde las posiciones actuales de los handles.
      // Siempre usa catmullRomToBezier → curvas suaves, sin panza ni picos.
      const rebuildFromHandles = () => {
        if (!editObj || draggingIdx === null) return
        const positions = aHandles.map(h => new fabric.Point(
          (h.circle.left as number) + ANCHOR_R,
          (h.circle.top  as number) + ANCHOR_R,
        ))
        if (positions.length < 2) return
        const oldClip = (editObj as any).clipPath as fabric.Group | undefined
        const isClosed = !!(editObj as any).path &&
          ((editObj as fabric.Path).path as any[][]).some((c: any[]) => c[0] === 'Z')
        let newObj: fabric.FabricObject

        if ((editObj as any).type === 'line') {
          const [p0, p1] = positions
          const cx  = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y)
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI
          newObj = new fabric.Line([-len / 2, 0, len / 2, 0], {
            left: cx, top: cy, angle: ang, originX: 'center', originY: 'center',
            stroke: editObj.stroke as string, strokeWidth: editObj.strokeWidth,
            strokeLineCap: (editObj.strokeLineCap ?? 'round') as any,
            fill: undefined, selectable: false, evented: true, clipPath: oldClip,
          })
        } else {
          let d: string
          if (positions.length === 2) {
            d = `M ${positions[0].x} ${positions[0].y} L ${positions[1].x} ${positions[1].y}`
          } else if (smoothAnchors !== null) {
            d = buildMixedPath(positions, smoothAnchors, isClosed)
          } else {
            d = catmullRomToBezier(positions)
            if (isClosed) d += ' Z'
          }
          newObj = new fabric.Path(d, {
            stroke: editObj.stroke as string, strokeWidth: editObj.strokeWidth,
            strokeLineCap: (editObj.strokeLineCap ?? 'round') as any,
            strokeLineJoin: (editObj.strokeLineJoin ?? 'round') as any,
            fill: (editObj.fill as string | null) ?? null,
            selectable: false, evented: true, clipPath: oldClip,
            strokeUniform: true,
          })
          if (smoothAnchors !== null)
            (newObj as any).__smoothAnchors = Array.from(smoothAnchors)
        }

        ;(newObj as any).hoverCursor = CURVE_CURSOR
        canvas.remove(editObj); canvas.add(newObj)
        inheritMockup(editObj, newObj)
        // History updated only on mouseUp via 'modify' entry, not during drag frames
        editObj = newObj
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        const pt = e.scenePoint

        // ¿Click en handle existente? → empezar drag
        for (let i = 0; i < aHandles.length; i++) {
          const h = aHandles[i]
          const hx = (h.circle.left as number) + ANCHOR_R
          const hy = (h.circle.top  as number) + ANCHOR_R
          if (Math.hypot(pt.x - hx, pt.y - hy) < ANCHOR_HIT) {
            setSelectedAnchor(i)
            canvas.requestRenderAll()
            preDragObj = editObj; draggingIdx = i; dragging = true
            return
          }
        }

        // ¿Click cerca de un segmento? → insertar anclaje
        if (editObj) {
          const anchorPositions = getAnchorPositions(editObj)
          const nearExisting = anchorPositions.some(p =>
            Math.hypot(pt.x - p.x, pt.y - p.y) < ANCHOR_HIT * 2)
          if (!nearExisting) {
            const rawCmds = (editObj as any).path
              ? ((editObj as fabric.Path).path as any[][]) : null
            const isBezier = !!rawCmds && rawCmds.some((c: any[]) => c[0] === 'C')
            const isClosed = !!rawCmds && rawCmds.some((c: any[]) => c[0] === 'Z')

            let insertIdx = -1
            if (isBezier) {
              const bzCmds = extractBezierCmds(editObj)
              const hit = findNearestBezierSeg(bzCmds, pt, 12)
              if (hit) insertIdx = hit.cmdIdx
            } else {
              insertIdx = nearPathSegmentIdx(editObj, pt, 8)
            }

            // Si no se encontró segmento, comprobar el segmento de cierre Z
            if (insertIdx < 0 && isClosed && anchorPositions.length >= 2) {
              const last  = anchorPositions[anchorPositions.length - 1]
              const first = anchorPositions[0]
              if (distPointToSegment(pt.x, pt.y, last.x, last.y, first.x, first.y) < 12) {
                insertIdx = anchorPositions.length
              }
            }

            if (insertIdx >= 0) {
              const newSmooth = new Set<number>()
              if (smoothAnchors === null) {
                // Path todo-suave (catmullRomToBezier): todos los anclas smooth incluido el nuevo
                const totalAfter = anchorPositions.length + 1
                for (let i = 0; i < totalAfter; i++) newSmooth.add(i)
              } else {
                // Desplazar índices; el nuevo ancla siempre es suave (el usuario eligió insertar con curvatura)
                for (const idx of smoothAnchors) newSmooth.add(idx >= insertIdx ? idx + 1 : idx)
                newSmooth.add(insertIdx)
              }
              smoothAnchors = newSmooth

              const positions = anchorPositions
              positions.splice(insertIdx, 0, pt)
              clearAnchorHandles(aHandles, canvas); aHandles = []
              const oldClip2 = (editObj as any).clipPath as fabric.Group | undefined
              let pathStr: string
              if (positions.length === 2) {
                pathStr = `M ${positions[0].x} ${positions[0].y} L ${positions[1].x} ${positions[1].y}`
              } else {
                pathStr = buildMixedPath(positions, smoothAnchors, isClosed)
              }
              const newPath = new fabric.Path(pathStr, {
                stroke: editObj.stroke as string, strokeWidth: editObj.strokeWidth,
                strokeLineCap: (editObj.strokeLineCap ?? 'round') as any,
                strokeLineJoin: (editObj.strokeLineJoin ?? 'round') as any,
                fill: (editObj.fill as string | null) ?? null,
                selectable: false, evented: true, clipPath: oldClip2,
                strokeUniform: true,
              })
              ;(newPath as any).__smoothAnchors = Array.from(smoothAnchors)
              ;(newPath as any).hoverCursor = CURVE_CURSOR
              undoHistory.current.push({ type: 'modify', prev: editObj, next: newPath })
              canvas.remove(editObj); canvas.add(newPath)
              inheritMockup(editObj, newPath)
              editObj = newPath
              aHandles = buildAnchorHandles(newPath, canvas)
              redoHistory.current = []
              canvas.requestRenderAll()
              return
            }
          }
        }

        // ¿Click en trazado dibujado? (o pieza del mockup si está desbloqueado)
        const allowMock = !mockupLockedRef.current
        const target = e.target
        if (target && (allowMock || !mockupObjects.current.includes(target)) && isDrawnPathOrLine(target)) {
          showAnchors(target)
        } else {
          // Fallback: proximity search for small shapes that Fabric's hit detection misses
          let found: fabric.FabricObject | null = null
          let minDist = 20
          for (const obj of canvas.getObjects()) {
            if (mockupObjects.current.includes(obj) || !isDrawnPathOrLine(obj)) continue
            const b = obj.getBoundingRect()
            const clampedX = Math.max(b.left, Math.min(b.left + b.width,  pt.x))
            const clampedY = Math.max(b.top,  Math.min(b.top  + b.height, pt.y))
            const d = Math.hypot(clampedX - pt.x, clampedY - pt.y)
            if (d < minDist) { minDist = d; found = obj }
          }
          if (found) showAnchors(found)
          else clearEdit()
        }
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        if (!dragging || draggingIdx === null || !editObj) return
        const pt = e.scenePoint
        aHandles[draggingIdx].circle.set({ left: pt.x - ANCHOR_R, top: pt.y - ANCHOR_R })
        rebuildFromHandles()
        canvas.requestRenderAll()
      }

      const onUp = () => {
        if (!dragging || !editObj) { dragging = false; draggingIdx = null; return }
        if (preDragObj && editObj !== preDragObj) {
          undoHistory.current.push({ type: 'modify', prev: preDragObj, next: editObj })
          redoHistory.current = []
        }
        preDragObj = null
        dragging = false
        clearAnchorHandles(aHandles, canvas)
        aHandles = buildAnchorHandles(editObj, canvas)
        const wasDragging = draggingIdx
        draggingIdx = null
        if (wasDragging !== null && aHandles[wasDragging]) {
          aHandles[wasDragging].circle.set({ fill: '#1D77E0' })
          selectedAnchorIdx = wasDragging
        }
        canvas.requestRenderAll()
      }

      const onKey = (e: KeyboardEvent) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnchorIdx !== null) {
          e.preventDefault()
          deleteAnchorAt(selectedAnchorIdx)
        }
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up',   onUp)
      window.addEventListener('keydown', onKey)

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up',   onUp)
        window.removeEventListener('keydown', onKey)
        clearEdit()
        canvas.defaultCursor = 'default'
      })
    }

    // ── Eraser ───────────────────────────────────────────────────────────────
    if (tool === 'eraser') {
      canvas.selection     = false
      canvas.defaultCursor = 'none'

      // Track all changes in one stroke for atomic undo
      const strokeRemoved = new Set<fabric.FabricObject>()
      const strokeAdded   = new Set<fabric.FabricObject>()

      const onDown = () => { isMouseDown.current = true }
      const onUp   = () => {
        isMouseDown.current = false
        if (strokeRemoved.size > 0 || strokeAdded.size > 0) {
          undoHistory.current.push({
            type: 'erase',
            removed: [...strokeRemoved],
            added:   [...strokeAdded],
          })
          redoHistory.current = []
          strokeRemoved.clear()
          strokeAdded.clear()
        }
      }

      let eraseRafId: number | null = null
      let eraseLastPt: fabric.Point | null = null

      const runErase = () => {
        eraseRafId = null
        if (!eraseLastPt || !isMouseDown.current) return
        const p = eraseLastPt
        const r = brushSizeRef.current

        const candidates = canvas.getObjects().filter(obj => {
          if (mockupObjects.current.includes(obj)) return false
          if (!(obj as any).path) return false
          const b = obj.getBoundingRect()
          return !(b.left > p.x + r || b.left + b.width  < p.x - r ||
                   b.top  > p.y + r || b.top  + b.height < p.y - r)
        })

        for (const obj of candidates) {
          const pathStrings = eraseCircleFromPath(obj as fabric.Path, p.x, p.y, r)
          if (pathStrings === null) continue

          const isNewPiece = strokeAdded.has(obj)
          canvas.remove(obj)
          if (isNewPiece) strokeAdded.delete(obj)
          else strokeRemoved.add(obj)

          for (const pathStr of pathStrings) {
            let newPath: fabric.Path
            try {
              newPath = new fabric.Path(pathStr, {
                stroke:         obj.stroke as string,
                strokeWidth:    obj.strokeWidth,
                strokeLineCap:  (obj.strokeLineCap  ?? 'round') as string,
                strokeLineJoin: (obj.strokeLineJoin ?? 'round') as string,
                // Open fragments with fill auto-close visually with a straight line, which looks wrong.
                // Strip fill so only the stroke outline remains after erasing.
                fill:           null,
                selectable:     false,
                evented:        false,
                strokeUniform:  true,
                clipPath:       clipPath.current ?? undefined,
              })
            } catch { continue }
            canvas.add(newPath)
            strokeAdded.add(newPath)
          }
        }
        canvas.requestRenderAll()
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        showSizeCursor((e.e as MouseEvent).clientX, (e.e as MouseEvent).clientY)
        if (!isMouseDown.current) return
        eraseLastPt = e.scenePoint
        if (eraseRafId === null) eraseRafId = requestAnimationFrame(runErase)
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:up',   onUp)
      canvas.on('mouse:move', onMove)
      canvasAreaRef.current?.addEventListener('mouseleave', () => hideSizeCursor())

      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:up',   onUp)
        canvas.off('mouse:move', onMove)
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
          redoHistory.current = []
          canvas.requestRenderAll()
        }
      }
      canvas.on('mouse:down', onDown)
      offs.push(() => canvas.off('mouse:down', onDown))
    }

    // ── Gotero ───────────────────────────────────────────────────────────────
    if (tool === 'eyedropper') {
      canvas.selection     = false
      canvas.defaultCursor = EYEDROPPER_CURSOR

      const onDown = (e: fabric.TPointerEventInfo) => {
        const vpt = (canvas.viewportTransform ?? [1,0,0,1,0,0]) as number[]
        const p   = e.scenePoint
        // Convert scene coords → canvas element pixels
        const px = Math.round(vpt[0] * p.x + vpt[4])
        const py = Math.round(vpt[3] * p.y + vpt[5])
        const ctx = (canvas as any).contextContainer as CanvasRenderingContext2D
        if (!ctx) return
        const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data
        if (a < 10) return   // transparent pixel — skip
        const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
        // Set as active color (stroke)
        colorRef.current = hex
        setPropStroke(hex)
        // If a non-mockup object is selected, apply to its stroke too
        const active = canvas.getActiveObject()
        if (active && !mockupObjects.current.includes(active)) {
          active.set({ stroke: hex })
          canvas.requestRenderAll()
        }
      }

      canvas.on('mouse:down', onDown)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Formas: rectángulo / elipse / línea (arrastrar para dibujar) ───────────
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      canvas.selection     = false
      canvas.defaultCursor = 'crosshair'
      let start: fabric.Point | null = null
      let shape: fabric.FabricObject | null = null
      let moved = false

      const onDown = (e: fabric.TPointerEventInfo) => {
        start = e.scenePoint
        moved = false
        const stroke = colorRef.current
        const sw     = brushSizeRef.current
        const fill   = fillRef.current ?? colorRef.current
        const common = { strokeWidth: sw, strokeUniform: true, selectable: false, evented: false } as const
        if (tool === 'line') {
          shape = new fabric.Line([start.x, start.y, start.x, start.y],
            { ...common, stroke, strokeLineCap: 'round' })
        } else if (tool === 'rect') {
          shape = new fabric.Rect({ ...common, left: start.x, top: start.y, width: 1, height: 1, fill, stroke })
        } else {
          shape = new fabric.Ellipse({ ...common, left: start.x, top: start.y, rx: 0.5, ry: 0.5, fill, stroke })
        }
        canvas.add(shape)
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        if (!start || !shape) return
        const p = e.scenePoint
        const shift = !!(e.e as MouseEvent)?.shiftKey
        let dx = p.x - start.x, dy = p.y - start.y
        if (Math.hypot(dx, dy) > 3) moved = true
        if (tool === 'line') {
          let ex = p.x, ey = p.y
          if (shift) {  // restringir a 0/45/90°
            const len = Math.hypot(dx, dy)
            const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
            ex = start.x + Math.cos(snapped) * len
            ey = start.y + Math.sin(snapped) * len
          }
          ;(shape as fabric.Line).set({ x2: ex, y2: ey })
        } else {
          if (shift) {  // cuadrado / círculo perfecto
            const m = Math.max(Math.abs(dx), Math.abs(dy))
            dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m
          }
          const left = Math.min(start.x, start.x + dx), top = Math.min(start.y, start.y + dy)
          const w = Math.abs(dx), h = Math.abs(dy)
          if (tool === 'rect') (shape as fabric.Rect).set({ left, top, width: w, height: h })
          else (shape as fabric.Ellipse).set({ left, top, rx: w / 2, ry: h / 2 })
        }
        shape.setCoords()
        canvas.requestRenderAll()
      }

      const onUp = () => {
        if (!shape) { start = null; return }
        if (!moved) { canvas.remove(shape); shape = null; start = null; return }  // click sin arrastrar
        shape.set({ selectable: true, evented: true })
        if (clipEnabledRef.current && clipPath.current) shape.clipPath = clipPath.current
        shape.setCoords()
        undoHistory.current.push({ type: 'add', obj: shape })
        redoHistory.current = []
        canvas.setActiveObject(shape)
        canvas.requestRenderAll()
        shape = null; start = null
        setTool('select')   // tras dibujar, pasa a seleccionar (como hace la herramienta texto)
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up',   onUp)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up',   onUp)
        if (shape && !moved) canvas.remove(shape)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Mano (pan arrastrando) ────────────────────────────────────────────────
    if (tool === 'hand') {
      canvas.selection     = false
      canvas.defaultCursor = 'grab'
      let panning = false
      let last = { x: 0, y: 0 }
      const onDown = (e: fabric.TPointerEventInfo) => {
        panning = true
        const ev = e.e as MouseEvent
        last = { x: ev.clientX, y: ev.clientY }
        canvas.setCursor('grabbing')
      }
      const onMove = (e: fabric.TPointerEventInfo) => {
        if (!panning) return
        const ev = e.e as MouseEvent
        const dx = ev.clientX - last.x, dy = ev.clientY - last.y
        last = { x: ev.clientX, y: ev.clientY }
        canvas.relativePan(new fabric.Point(dx, dy))
        setPanned(true)
      }
      const onUp = () => { panning = false; canvas.setCursor('grab') }
      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up',   onUp)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up',   onUp)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Zoom (click acerca, Alt+click aleja) ──────────────────────────────────
    if (tool === 'zoom') {
      canvas.selection     = false
      canvas.defaultCursor = 'zoom-in'
      const onDown = (e: fabric.TPointerEventInfo) => {
        const ev  = e.e as MouseEvent
        const cur = canvas.getZoom()
        const next = Math.min(8, Math.max(0.25, ev.altKey ? cur / 1.4 : cur * 1.4))
        const pt   = canvas.getPointer(e.e as fabric.TPointerEvent, true)
        canvas.zoomToPoint(new fabric.Point(pt.x, pt.y), next)
        canvas.requestRenderAll()
        setZoom(next)
      }
      canvas.on('mouse:down', onDown)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Select ───────────────────────────────────────────────────────────────
    if (tool === 'select') {
      const syncProps = (obj: fabric.FabricObject | null) => {
        if (!obj) { setHasSel(false); setIsText(false); setActiveTexKind(null); return }
        setHasSel(true)
        setPropFill(typeof obj.fill   === 'string' ? obj.fill   : null)
        setPropStroke(typeof obj.stroke === 'string' ? obj.stroke : '#000000')
        setPropSWidth(obj.strokeWidth ?? 1)
        // Grosor "Mixto" si hay varios objetos seleccionados con distinto strokeWidth
        const sel = (canvas.getActiveObjects?.() ?? []).filter(o => !mockupObjects.current.includes(o))
        setPropSWidthMixed(sel.length > 1 && new Set(sel.map(o => o.strokeWidth ?? 0)).size > 1)
        // Si el objeto ya tiene una textura, abrir su editor de colores con su paleta
        const tex = (obj as any)._texture as { kind: TextureKind; colors: string[] } | undefined
        if (tex) { setActiveTexKind(tex.kind); setTexColors(prev => ({ ...prev, [tex.kind]: tex.colors })) }
        else setActiveTexKind(null)
        setPropX(Math.round(obj.left ?? 0))
        setPropY(Math.round(obj.top  ?? 0))
        setPropW(Math.round((obj.width  ?? 0) * Math.abs(obj.scaleX ?? 1)))
        setPropH(Math.round((obj.height ?? 0) * Math.abs(obj.scaleY ?? 1)))
        setPropAngle(Math.round((obj.angle ?? 0) * 10) / 10)
        setPropOpacity(Math.round((obj.opacity ?? 1) * 100))
        if (obj instanceof fabric.IText) {
          setIsText(true)
          setPropFontFamily(obj.fontFamily ?? 'Arial')
          setPropFontSize(obj.fontSize ?? 24)
        } else {
          setIsText(false)
        }
      }

      const onCreated = (e: { selected?: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
      const onUpdated = (e: { selected?: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
      const onCleared = () => syncProps(null)

      const onScaled   = (e: any) => syncProps(e.target ?? null)
      const onMoved    = (e: any) => syncProps(e.target ?? null)
      const onRotated  = (e: any) => syncProps(e.target ?? null)

      // Selección directa de piezas del mockup: el hit-test nativo de Fabric falla
      // con estas piezas SVG escaladas (devuelve "vacío" y deselecciona). Hacemos el
      // hit-test nosotros — pieza superior (orden Z) que contiene el punto — y la
      // seleccionamos a mano. Solo cuando la prenda está desbloqueada.
      const onDownMockup = (e: fabric.TPointerEventInfo) => {
        if (mockupLockedRef.current) return
        const target = e.target as fabric.FabricObject | undefined
        if (target && !mockupObjects.current.includes(target)) return  // objeto normal → Fabric lo maneja
        const pt = e.scenePoint
        const pieces = mockupObjects.current
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i]
          if (p.visible === false) continue
          if (p.containsPoint(pt)) {
            p.set({ selectable: true, evented: true })
            if (canvas.getActiveObject() !== p) { canvas.setActiveObject(p); canvas.requestRenderAll() }
            return
          }
        }
      }

      canvas.on('mouse:down', onDownMockup)
      canvas.on('selection:created', onCreated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:cleared', onCleared)
      canvas.on('object:scaled',    onScaled)
      canvas.on('object:moving',    onMoved)
      canvas.on('object:rotating',  onRotated)

      offs.push(() => {
        canvas.off('mouse:down', onDownMockup)
        canvas.off('selection:created', onCreated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:cleared', onCleared)
        canvas.off('object:scaled',    onScaled)
        canvas.off('object:moving',    onMoved)
        canvas.off('object:rotating',  onRotated)
        setHasSel(false)
        setIsText(false)
      })
    }

    // ── Text ─────────────────────────────────────────────────────────────────
    if (tool === 'text') {
      canvas.selection     = false
      canvas.defaultCursor = 'text'

      const onDown = (e: fabric.TPointerEventInfo) => {
        if (e.target instanceof fabric.IText) {
          canvas.setActiveObject(e.target)
          ;(e.target as fabric.IText).enterEditing()
          return
        }
        const pt = e.scenePoint
        const text = new fabric.IText('Texto', {
          left: pt.x, top: pt.y,
          fontSize: 24,
          fontFamily: fontFamilyRef.current,
          fill: colorRef.current,
          stroke: undefined,
          strokeWidth: 0,
          selectable: true, evented: true,
          perPixelTargetFind: false,   // seleccionable por toda la caja del renglon (incluye espacios)
        })
        canvas.add(text)
        undoHistory.current.push({ type: 'add', obj: text })
        redoHistory.current = []
        canvas.setActiveObject(text)
        ;(text as fabric.IText).enterEditing()
        ;(text as fabric.IText).selectAll()
        canvas.requestRenderAll()
      }

      canvas.on('mouse:down', onDown)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.defaultCursor = 'default'
      })
    }

    return () => offs.forEach(fn => fn())
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps


  // ── Importar y vectorizar PNG ────────────────────────────────────────────────
  async function handleImportPng(file: File) {
    const canvas = fc.current
    if (!canvas) return
    setVectorizing(true)
    try {
      // Cargar imagen en un canvas temporal para obtener ImageData
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = url
      })
      URL.revokeObjectURL(url)

      const tmp = document.createElement('canvas')
      tmp.width  = img.width
      tmp.height = img.height
      const ctx = tmp.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, img.width, img.height)

      // Vectorizar con imagetracerjs
      const { default: ImageTracer } = await import('imagetracerjs')
      const svgStr: string = ImageTracer.imagedataToSVG(imageData, {
        numberofcolors: 8,
        colorsampling: 2,
        ltres: 1,
        qtres: 1,
        pathomit: 16,
        rightangleenhance: false,
        blurradius: 0,
      })

      // Cargar el SVG en Fabric
      const { objects } = await fabric.loadSVGFromString(svgStr)
      const validObjs = objects.filter(Boolean) as fabric.FabricObject[]
      if (!validObjs.length) return

      // Agrupar y escalar para que entre en el canvas
      const group = new fabric.Group(validObjs, { selectable: true, evented: true })
      const cw = canvas.width  ?? 800
      const ch = canvas.height ?? 600
      const scale = Math.min(cw / (group.width ?? 1), ch / (group.height ?? 1)) * 0.85
      group.set({ scaleX: scale, scaleY: scale, left: cw / 2, top: ch / 2, originX: 'center', originY: 'center' })
      group.setCoords()

      canvas.add(group)
      canvas.setActiveObject(group)
      undoHistory.current.push({ type: 'add', obj: group })
      redoHistory.current = []
      canvas.requestRenderAll()
      setTool('select')
    } catch (err) {
      console.error('Error al vectorizar:', err)
    } finally {
      setVectorizing(false)
    }
  }

  // Importar imagen tal cual (raster), sin vectorizar — como "Colocar" de Illustrator
  async function handlePlaceImage(file: File) {
    const canvas = fc.current
    if (!canvas) return
    try {
      const url = URL.createObjectURL(file)
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
      URL.revokeObjectURL(url)
      const cw = canvas.width  ?? 800
      const ch = canvas.height ?? 600
      const scale = Math.min(cw / (img.width ?? 1), ch / (img.height ?? 1)) * 0.85
      img.set({ scaleX: scale, scaleY: scale, left: cw / 2, top: ch / 2, originX: 'center', originY: 'center' })
      if (clipEnabledRef.current && clipPath.current) img.clipPath = clipPath.current
      img.setCoords()
      canvas.add(img)
      canvas.setActiveObject(img)
      undoHistory.current.push({ type: 'add', obj: img })
      redoHistory.current = []
      canvas.requestRenderAll()
      setTool('select')
    } catch (err) {
      console.error('Error al importar la imagen:', err)
    }
  }

  // ── Quitar fondo de una imagen ───────────────────────────────────────────────
  async function removeBackground() {
    const canvas = fc.current
    if (!canvas) return
    const img = canvas.getActiveObject()
    if (!img || img.type !== 'image') return
    const fimg = img as fabric.FabricImage
    const el = fimg.getElement() as HTMLImageElement | HTMLCanvasElement
    const w = (el as HTMLImageElement).naturalWidth || el.width
    const h = (el as HTMLImageElement).naturalHeight || el.height
    if (!w || !h) return
    setVectorizing(true)
    try {
      const tmp = document.createElement('canvas')
      tmp.width = w; tmp.height = h
      const tctx = tmp.getContext('2d', { willReadFrequently: true })!
      tctx.drawImage(el, 0, 0, w, h)
      let imageData: ImageData
      try { imageData = tctx.getImageData(0, 0, w, h) }
      catch { console.error('No se puede procesar (imagen con restricciones CORS)'); return }
      removeBgFromImageData(imageData, 42)
      tctx.putImageData(imageData, 0, 0)
      const dataURL = tmp.toDataURL('image/png')
      const newImg = await fabric.FabricImage.fromURL(dataURL)
      newImg.set({
        left: fimg.left, top: fimg.top, scaleX: fimg.scaleX, scaleY: fimg.scaleY,
        angle: fimg.angle, originX: fimg.originX, originY: fimg.originY,
        opacity: fimg.opacity, selectable: true, evented: true,
      })
      if (clipEnabledRef.current && clipPath.current) newImg.clipPath = clipPath.current
      newImg.setCoords()
      canvas.remove(fimg)
      canvas.add(newImg)
      canvas.setActiveObject(newImg)
      setSelectedObj(newImg)
      undoHistory.current.push({ type: 'erase', removed: [fimg], added: [newImg] })
      redoHistory.current = []
      canvas.requestRenderAll()
    } catch (err) {
      console.error('Error al quitar el fondo:', err)
    } finally {
      setVectorizing(false)
    }
  }

  // ── Texturas ─────────────────────────────────────────────────────────────────
  // Aplica un patrón de textura a un objeto y guarda su receta (kind + colores) para poder
  // recolorearla después sin perder la textura.
  function setObjTexture(obj: fabric.FabricObject, kind: TextureKind, colors: string[]) {
    const tile = makeTextureCanvas(kind, colors)
    const pattern = new fabric.Pattern({ source: tile, repeat: 'repeat' })
    obj.set({ fill: pattern as any, dirty: true })
    ;(obj as any)._texture = { kind, colors: [...colors] }
  }

  // Piezas de la prenda que pueden recibir tela/color (las que tienen área de relleno).
  function fillableGarmentPieces(): fabric.FabricObject[] {
    return mockupObjects.current.filter(o => {
      if (o.visible === false) return false
      const f = (o as any).fill
      return typeof f === 'string' ? (f !== '' && f !== 'transparent') : f != null
    })
  }

  // ¿A qué se aplica la tela/color? A lo seleccionado si hay algo; si no, a toda la prenda.
  function fillTargets(): { targets: fabric.FabricObject[]; label: string } {
    const active = fc.current?.getActiveObject()
    if (active) {
      if (active.type === 'activeselection') {
        return { targets: (active as fabric.ActiveSelection).getObjects(), label: 'la selección' }
      }
      const isPiece = mockupObjects.current.includes(active)
      return { targets: [active], label: isPiece ? 'la pieza' : 'la figura' }
    }
    return { targets: fillableGarmentPieces(), label: 'toda la prenda' }
  }

  // Aplica un cambio de relleno a varios objetos como UN solo paso de historial.
  function applyFillToTargets(targets: fabric.FabricObject[], mut: (o: fabric.FabricObject) => void, verb: string, label: string) {
    const canvas = fc.current
    if (!canvas) return
    if (!targets.length) { onToast?.('No hay nada para pintar — elegí una pieza o creá una figura'); return }
    const items = targets.map(o => ({ obj: o, prevFill: o.fill as fabric.TFiller | string | null }))
    targets.forEach(mut)
    undoHistory.current.push(items.length === 1
      ? { type: 'fill', obj: items[0].obj, prevFill: items[0].prevFill }
      : { type: 'fillBatch', items })
    redoHistory.current = []
    canvas.requestRenderAll()
    onToast?.(`${verb} a ${label}`)
  }

  function applyTexture(kind: TextureKind) {
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => setObjTexture(o, kind, texColors[kind]), 'Tela aplicada', label)
    setActiveTexKind(kind)
  }

  // Color sólido de la prenda (o de lo seleccionado): reemplaza cualquier textura.
  function applyGarmentSolid(val: string) {
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => { o.set({ fill: val, dirty: true }); delete (o as any)._texture }, 'Color aplicado', label)
    setActiveTexKind(null)
    setPropFill(val)
  }

  // Aplica una paleta completa a una textura: actualiza lo seleccionado, o todas las
  // piezas de la prenda que ya tengan esa textura si no hay nada seleccionado.
  function applyTexPalette(kind: TextureKind, pal: string[]) {
    setTexColors(prev => ({ ...prev, [kind]: pal }))
    const canvas = fc.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    const targets = active
      ? (active.type === 'activeselection' ? (active as fabric.ActiveSelection).getObjects() : [active])
      : mockupObjects.current.filter(o => (o as any)._texture?.kind === kind)
    targets.forEach(o => setObjTexture(o, kind, pal))
    canvas.requestRenderAll()
  }
  // Color principal: ajusta el resto automáticamente
  function setTexPrimary(kind: TextureKind, val: string) { applyTexPalette(kind, deriveTexPalette(kind, val)) }
  // Edición fina de un slot (opciones avanzadas)
  function updateTexColor(kind: TextureKind, i: number, val: string) {
    applyTexPalette(kind, texColors[kind].map((c, idx) => idx === i ? val : c))
  }
  function resetTexColors(kind: TextureKind) { applyTexPalette(kind, defaultTexPalette(kind)) }

  // ── Property panel handlers ─────────────────────────────────────────────────
  function applyFill(val: string | null) {
    setPropFill(val)
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ fill: val ?? undefined })
      delete (obj as any)._texture   // color sólido reemplaza la textura
      fc.current?.requestRenderAll()
    }
  }

  function applyX(val: number) {
    setPropX(val)
    const obj = fc.current?.getActiveObject()
    if (obj) { obj.set({ left: val }); obj.setCoords(); fc.current?.requestRenderAll() }
  }
  function applyY(val: number) {
    setPropY(val)
    const obj = fc.current?.getActiveObject()
    if (obj) { obj.set({ top: val }); obj.setCoords(); fc.current?.requestRenderAll() }
  }
  function applyW(val: number) {
    const v = Math.max(1, val)
    setPropW(v)
    const obj = fc.current?.getActiveObject()
    if (obj && (obj.width ?? 0) > 0) {
      obj.set({ scaleX: v / obj.width! }); obj.setCoords(); fc.current?.requestRenderAll()
    }
  }
  function applyH(val: number) {
    const v = Math.max(1, val)
    setPropH(v)
    const obj = fc.current?.getActiveObject()
    if (obj && (obj.height ?? 0) > 0) {
      obj.set({ scaleY: v / obj.height! }); obj.setCoords(); fc.current?.requestRenderAll()
    }
  }
  function applyAngle(val: number) {
    setPropAngle(val)
    const obj = fc.current?.getActiveObject()
    if (obj) { obj.set({ angle: val }); obj.setCoords(); fc.current?.requestRenderAll() }
  }

  function applyStroke(val: string) {
    setPropStroke(val)
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ stroke: val })
      fc.current?.requestRenderAll()
    }
  }

  function applyStrokeWidth(val: number) {
    const clamped = Math.max(0.5, val)
    setPropSWidth(clamped)
    setPropSWidthMixed(false)   // al escribir un número se igualan todos
    const canvas = fc.current
    if (!canvas) return
    const objs = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
    objs.forEach(o => o.set({ strokeWidth: clamped }))
    canvas.requestRenderAll()
  }

  function applyOpacity(val: number) {
    const clamped = Math.min(100, Math.max(0, val))
    setPropOpacity(clamped)
    const obj = fc.current?.getActiveObject()
    if (!obj || mockupObjects.current.includes(obj)) return
    const prev = obj.opacity ?? 1
    obj.set({ opacity: clamped / 100 })
    undoHistory.current.push({ type: 'opacity', obj, prevOpacity: prev })
    redoHistory.current = []
    fc.current?.requestRenderAll()
  }

  // ── Alinear (como el panel Alinear de Illustrator) ──────────────────────────
  // Si hay 2+ objetos seleccionados, se alinean entre sí (caja de la selección).
  // Si hay uno solo, se alinea respecto a la remera (o al lienzo si no hay remera).
  type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'
  function mockupBounds(): { left: number; top: number; width: number; height: number } | null {
    const m = mockupObjects.current
    if (!m.length) return null
    const r = m.map(o => o.getBoundingRect())
    const minX = Math.min(...r.map(b => b.left)), minY = Math.min(...r.map(b => b.top))
    const maxX = Math.max(...r.map(b => b.left + b.width)), maxY = Math.max(...r.map(b => b.top + b.height))
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
  }
  function alignObjects(mode: AlignMode) {
    const canvas = fc.current
    if (!canvas) return
    const targets = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
    if (!targets.length) return
    // Refrescar la caja real: si el objeto (p. ej. un texto editado) tiene aCoords viejos,
    // getBoundingRect daría una caja desactualizada y la alineación lo mandaría fuera.
    targets.forEach(o => o.setCoords())
    const prev = targets.map(o => ({ obj: o, left: o.left ?? 0, top: o.top ?? 0 }))
    let ref: { left: number; top: number; width: number; height: number }
    if (targets.length >= 2) {
      const r = targets.map(o => o.getBoundingRect())
      const minX = Math.min(...r.map(b => b.left)), minY = Math.min(...r.map(b => b.top))
      const maxX = Math.max(...r.map(b => b.left + b.width)), maxY = Math.max(...r.map(b => b.top + b.height))
      ref = { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
    } else {
      ref = mockupBounds() ?? { left: 0, top: 0, width: canvas.getWidth(), height: canvas.getHeight() }
    }
    targets.forEach(o => {
      const b = o.getBoundingRect()
      let dx = 0, dy = 0
      if (mode === 'left')         dx = ref.left - b.left
      else if (mode === 'hcenter') dx = (ref.left + ref.width / 2) - (b.left + b.width / 2)
      else if (mode === 'right')   dx = (ref.left + ref.width) - (b.left + b.width)
      else if (mode === 'top')     dy = ref.top - b.top
      else if (mode === 'vmiddle') dy = (ref.top + ref.height / 2) - (b.top + b.height / 2)
      else if (mode === 'bottom')  dy = (ref.top + ref.height) - (b.top + b.height)
      o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy })
      o.setCoords()
    })
    // Registrar el movimiento como un paso deshacible (si algo se movió)
    if (prev.some(p => p.left !== (p.obj.left ?? 0) || p.top !== (p.obj.top ?? 0))) {
      undoHistory.current.push({ type: 'transform', items: prev })
      redoHistory.current = []
    }
    canvas.requestRenderAll()
    const act = canvas.getActiveObject()
    if (act) { setPropX(Math.round(act.left ?? 0)); setPropY(Math.round(act.top ?? 0)) }
  }
  // Distribuir: reparte el espacio entre 3+ objetos de forma pareja (por centros).
  function distributeObjects(axis: 'h' | 'v') {
    const canvas = fc.current
    if (!canvas) return
    const targets = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
    if (targets.length < 3) return
    targets.forEach(o => o.setCoords())
    const prev = targets.map(o => ({ obj: o, left: o.left ?? 0, top: o.top ?? 0 }))
    const withRect = targets.map(o => ({ o, b: o.getBoundingRect() }))
    withRect.sort((a, z) => axis === 'h'
      ? (a.b.left + a.b.width / 2) - (z.b.left + z.b.width / 2)
      : (a.b.top + a.b.height / 2) - (z.b.top + z.b.height / 2))
    const first = withRect[0], last = withRect[withRect.length - 1]
    const c0 = axis === 'h' ? first.b.left + first.b.width / 2 : first.b.top + first.b.height / 2
    const c1 = axis === 'h' ? last.b.left + last.b.width / 2 : last.b.top + last.b.height / 2
    const step = (c1 - c0) / (withRect.length - 1)
    withRect.forEach(({ o, b }, i) => {
      if (i === 0 || i === withRect.length - 1) return
      const target = c0 + step * i
      if (axis === 'h') { const cur = b.left + b.width / 2; o.set({ left: (o.left ?? 0) + (target - cur) }) }
      else              { const cur = b.top + b.height / 2; o.set({ top:  (o.top  ?? 0) + (target - cur) }) }
      o.setCoords()
    })
    if (prev.some(p => p.left !== (p.obj.left ?? 0) || p.top !== (p.obj.top ?? 0))) {
      undoHistory.current.push({ type: 'transform', items: prev })
      redoHistory.current = []
    }
    canvas.requestRenderAll()
  }

  // ── Pathfinder (unir / restar / intersecar / excluir) ───────────────────────
  // npm bloquea polygon-clipping en este entorno, así que se hace por rasterizado:
  // se compone la silueta de las formas con operaciones de canvas y se re-vectoriza
  // con imagetracerjs. Funciona con cualquier forma (curvas, texto), bordes apenas blandos.
  type PathfinderOp = 'unite' | 'subtract' | 'intersect' | 'exclude'
  function fillLum(c: string): number {
    let r = 0, g = 0, b = 0
    const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (m) { r = +m[1]; g = +m[2]; b = +m[3] }
    else if (c[0] === '#') { const h = c.slice(1); const n = h.length === 3 ? h.split('').map(x => x + x).join('') : h; r = parseInt(n.slice(0, 2), 16); g = parseInt(n.slice(2, 4), 16); b = parseInt(n.slice(4, 6), 16) }
    else return 1
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  async function pathfinder(op: PathfinderOp) {
    const canvas = fc.current
    if (!canvas) return
    const targets = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
    if (targets.length < 2) return
    setVectorizing(true)
    try {
      // 1. Caja envolvente en coordenadas de escena + supersampling
      const rects = targets.map(o => o.getBoundingRect())
      const pad = 4
      const bx = Math.min(...rects.map(r => r.left)) - pad
      const by = Math.min(...rects.map(r => r.top)) - pad
      const bw = Math.max(...rects.map(r => r.left + r.width)) - bx + pad
      const bh = Math.max(...rects.map(r => r.top + r.height)) - by + pad
      let scale = Math.min(4, 2200 / Math.max(bw, bh))
      scale = Math.max(1, scale)
      const W = Math.max(1, Math.round(bw * scale)), H = Math.max(1, Math.round(bh * scale))
      const vpt: number[] = [scale, 0, 0, scale, -bx * scale, -by * scale]

      // 2. Silueta negra de cada forma en su propio canvas (orden Z de la escena)
      const ordered = [...targets].sort((a, z) => canvas.getObjects().indexOf(a) - canvas.getObjects().indexOf(z))
      const sils = await Promise.all(ordered.map(async o => {
        const elc = document.createElement('canvas'); elc.width = W; elc.height = H
        const sc = new fabric.StaticCanvas(elc, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false })
        sc.viewportTransform = vpt as any
        const clone = await o.clone()
        clone.clipPath = undefined
        clone.set({ fill: '#000', stroke: '#000', strokeWidth: clone.strokeWidth || 0, opacity: 1, shadow: null as any })
        sc.add(clone); sc.renderAll()
        const out = document.createElement('canvas'); out.width = W; out.height = H
        out.getContext('2d')!.drawImage(elc, 0, 0)
        sc.dispose()
        return out
      }))

      // 3. Componer la operación booleana con globalCompositeOperation
      const res = document.createElement('canvas'); res.width = W; res.height = H
      const rc = res.getContext('2d')!
      if (op === 'unite') { sils.forEach(s => rc.drawImage(s, 0, 0)) }
      else if (op === 'intersect') { rc.drawImage(sils[0], 0, 0); rc.globalCompositeOperation = 'destination-in'; for (let i = 1; i < sils.length; i++) rc.drawImage(sils[i], 0, 0) }
      else if (op === 'subtract') { rc.drawImage(sils[0], 0, 0); rc.globalCompositeOperation = 'destination-out'; for (let i = 1; i < sils.length; i++) rc.drawImage(sils[i], 0, 0) }
      else { sils.forEach((s, i) => { rc.globalCompositeOperation = i === 0 ? 'source-over' : 'xor'; rc.drawImage(s, 0, 0) }) }

      // 4. Pasar a negro-sobre-blanco y vectorizar
      const tr = document.createElement('canvas'); tr.width = W; tr.height = H
      const tc = tr.getContext('2d')!
      tc.fillStyle = '#fff'; tc.fillRect(0, 0, W, H)
      tc.drawImage(res, 0, 0)
      const imageData = tc.getImageData(0, 0, W, H)
      const { default: ImageTracer } = await import('imagetracerjs')
      const svgStr: string = ImageTracer.imagedataToSVG(imageData, {
        numberofcolors: 2, colorsampling: 0, ltres: 0.5, qtres: 0.5,
        pathomit: 4, rightangleenhance: true, blurradius: 0, scale: 1,
      })

      // 5. Quedarse con los contornos oscuros y mapearlos de px → escena
      const tags = svgStr.match(/<path\b[^>]*>/g) ?? []
      const darkDs: string[] = []
      for (const tag of tags) {
        const dm = tag.match(/\bd="([^"]+)"/); if (!dm) continue
        const fm = tag.match(/\bfill="([^"]+)"/)
        if (fillLum(fm?.[1] ?? '#000') < 0.5) darkDs.push(dm[1])
      }
      if (!darkDs.length) { setVectorizing(false); return }
      const sceneD = darkDs.map(d => transformPath(d, (x, y) => [bx + x / scale, by + y / scale])).join(' ')

      // 6. Crear el resultado con el relleno/trazo de la forma de más atrás y reemplazar
      const base = ordered[0]
      const result = new fabric.Path(sceneD, {
        fill: (typeof base.fill === 'string' ? base.fill : null) ?? colorRef.current,
        stroke: typeof base.stroke === 'string' ? base.stroke : null,
        strokeWidth: base.strokeWidth ?? 0,
        strokeUniform: true, fillRule: 'evenodd',
        selectable: true, evented: true,
      })
      if (clipEnabledRef.current && clipPath.current) result.clipPath = clipPath.current
      canvas.discardActiveObject()
      targets.forEach(o => canvas.remove(o))
      canvas.add(result)
      canvas.setActiveObject(result)
      undoHistory.current.push({ type: 'erase', removed: targets, added: [result] })
      redoHistory.current = []
      canvas.requestRenderAll()
      setTool('select')
    } catch (err) {
      console.error('Pathfinder falló:', err)
    } finally {
      setVectorizing(false)
    }
  }

  function applyFontFamily(val: string) {
    setPropFontFamily(val)
    fontFamilyRef.current = val
    const obj = fc.current?.getActiveObject()
    if (obj instanceof fabric.IText) {
      obj.set({ fontFamily: val })
      fc.current?.requestRenderAll()
    }
  }

  function applyFontSize(val: number) {
    const clamped = Math.max(6, val)
    setPropFontSize(clamped)
    const obj = fc.current?.getActiveObject()
    if (obj instanceof fabric.IText) {
      obj.set({ fontSize: clamped })
      fc.current?.requestRenderAll()
    }
  }

  // ── Keyboard: Undo / Redo / Delete / Copy / Paste ──────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const canvas = fc.current
      if (!canvas) return

      const ae = document.activeElement as HTMLElement | null
      const inField = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
      const act0 = canvas.getActiveObject()
      const editingText = act0 instanceof fabric.IText && (act0 as fabric.IText).isEditing
      const typing = inField || editingText
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+S — guardar (siempre; evita el "guardar página HTML" del navegador)
      if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); handleSave(); return }
      // Mientras escribís (texto en el lienzo o un campo), no disparar atajos del lienzo
      if (typing) return

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = canvas.getActiveObject()
        if (active && !(active instanceof fabric.IText && (active as fabric.IText).isEditing)) {
          const targets = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
          if (targets.length > 0) {
            e.preventDefault()
            canvas.discardActiveObject()
            for (const obj of targets) {
              undoHistory.current.push({ type: 'remove', obj })
              canvas.remove(obj)
            }
            canvas.requestRenderAll()
            redoHistory.current = []
          }
          return
        }
      }

      // Atajos de herramienta (un solo carácter, sin Ctrl) — al estilo Illustrator
      if (!ctrl && !e.altKey) {
        switch (e.key) {
          case 'v': case 'V': setTool('select');     return
          case 'p': case 'P': setTool('pen');        return
          case 'n': case 'N': setTool('pencil');     return
          case 't': case 'T': setTool('text');       return
          case 'm': case 'M': setTool('rect');       return
          case 'l': case 'L': setTool('ellipse');    return
          case '\\':          setTool('line');       return
          case 'h': case 'H': setTool('hand');       return
          case 'z': case 'Z': setTool('zoom');       return
          case 'i': case 'I': setTool('eyedropper'); return
        }
      }

      // Ctrl+G — agrupar / Ctrl+Shift+G — desagrupar
      if (ctrl && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        if (e.shiftKey) ungroupSelection()
        else groupSelection()
        return
      }

      // Ctrl+D — duplicar el/los objeto(s) seleccionado(s)
      if (ctrl && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        const targets = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
        if (!targets.length) return
        canvas.discardActiveObject()
        Promise.all(targets.map(o => o.clone())).then((clones: fabric.FabricObject[]) => {
          clones.forEach(c => {
            c.set({ left: (c.left ?? 0) + 16, top: (c.top ?? 0) + 16, selectable: true, evented: true })
            if (clipEnabledRef.current && clipPath.current && !(c instanceof fabric.IText)) c.clipPath = clipPath.current
            c.setCoords()
            canvas.add(c)
            undoHistory.current.push({ type: 'add', obj: c })
          })
          redoHistory.current = []
          if (clones.length === 1) canvas.setActiveObject(clones[0])
          else canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas }))
          canvas.requestRenderAll()
        })
        return
      }

      // Orden Z: Ctrl+] adelante / Ctrl+[ atrás (con Shift = al frente / al fondo)
      if (ctrl && (e.key === ']' || e.key === '[')) {
        e.preventDefault()
        if (e.key === ']') reorderSelected(e.shiftKey ? 'front' : 'forward')
        else reorderSelected(e.shiftKey ? 'back' : 'backward')
        return
      }

      // Ctrl+C — copy
      if (ctrl && e.key === 'c') {
        const active = canvas.getActiveObject()
        if (active && !mockupObjects.current.includes(active)) {
          clipboardBuf.current = active
        }
        return
      }

      // Ctrl+V — paste Fabric object
      if (ctrl && e.key === 'v') {
        const buf = clipboardBuf.current
        if (buf) {
          buf.clone().then((cloned: fabric.FabricObject) => {
            cloned.set({
              left: (buf.left ?? 0) + 15,
              top:  (buf.top  ?? 0) + 15,
              selectable: true, evented: true,
            })
            if (clipPath.current && !(cloned instanceof fabric.IText)) cloned.clipPath = clipPath.current
            canvas.add(cloned)
            canvas.setActiveObject(cloned)
            canvas.requestRenderAll()
            undoHistory.current.push({ type: 'add', obj: cloned })
            redoHistory.current = []
          })
        }
        return
      }

      if (!ctrl) return

      // Ignorar el auto-repeat del teclado: mantener apretado Ctrl+Z (o Ctrl+Shift+Z)
      // dispararía varios keydown y deshacía/rehacía 2-4 pasos de una. Un paso por pulsación.
      if (e.repeat) return

      // Ctrl+Shift+Z — redo
      if (e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
        e.preventDefault()
        const entry = redoHistory.current.pop()
        if (!entry) return
        if (entry.type === 'add') {
          canvas.add(entry.obj)
          undoHistory.current.push(entry)
        } else if (entry.type === 'remove') {
          canvas.remove(entry.obj)
          undoHistory.current.push(entry)
        } else if (entry.type === 'modify') {
          canvas.remove(entry.prev)
          canvas.add(entry.next)
          undoHistory.current.push(entry)
        } else if (entry.type === 'erase') {
          entry.removed.forEach(obj => canvas.remove(obj))
          entry.added.forEach(obj => canvas.add(obj))
          undoHistory.current.push(entry)
        } else if (entry.type === 'opacity') {
          const cur = entry.obj.opacity ?? 1
          entry.obj.set({ opacity: entry.prevOpacity })
          undoHistory.current.push({ type: 'opacity', obj: entry.obj, prevOpacity: cur })
        } else if (entry.type === 'group') {
          entry.group = makeGroup(entry.children)   // rehacer el grupo
          undoHistory.current.push(entry)
        } else if (entry.type === 'ungroup') {
          dissolveGroup(entry.group)                // rehacer la disolución
          undoHistory.current.push(entry)
        } else if (entry.type === 'transform') {
          const cur = entry.items.map(it => ({ obj: it.obj, left: it.obj.left ?? 0, top: it.obj.top ?? 0 }))
          entry.items.forEach(it => { it.obj.set({ left: it.left, top: it.top }); it.obj.setCoords() })
          undoHistory.current.push({ type: 'transform', items: cur })
        } else if (entry.type === 'fillBatch') {
          const cur = entry.items.map(it => ({ obj: it.obj, prevFill: it.obj.fill as fabric.TFiller | string | null }))
          entry.items.forEach(it => it.obj.set({ fill: it.prevFill as string, dirty: true }))
          undoHistory.current.push({ type: 'fillBatch', items: cur })
        } else {
          const curFill = entry.obj.fill
          entry.obj.set({ fill: entry.prevFill as string })
          undoHistory.current.push({ type: 'fill', obj: entry.obj, prevFill: curFill as fabric.TFiller | string | null })
        }
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        return
      }

      // Ctrl+Z — undo
      if (!e.shiftKey && e.key === 'z') {
        e.preventDefault()
        const entry = undoHistory.current.pop()
        if (!entry) return
        if (entry.type === 'add') {
          canvas.remove(entry.obj)
          redoHistory.current.push(entry)
        } else if (entry.type === 'remove') {
          canvas.add(entry.obj)
          redoHistory.current.push(entry)
        } else if (entry.type === 'modify') {
          canvas.remove(entry.next)
          canvas.add(entry.prev)
          redoHistory.current.push(entry)
        } else if (entry.type === 'erase') {
          entry.added.forEach(obj => canvas.remove(obj))
          entry.removed.forEach(obj => canvas.add(obj))
          redoHistory.current.push(entry)
        } else if (entry.type === 'opacity') {
          const cur = entry.obj.opacity ?? 1
          entry.obj.set({ opacity: entry.prevOpacity })
          redoHistory.current.push({ type: 'opacity', obj: entry.obj, prevOpacity: cur })
        } else if (entry.type === 'group') {
          dissolveGroup(entry.group)                // deshacer: disolver el grupo
          redoHistory.current.push(entry)
        } else if (entry.type === 'ungroup') {
          entry.group = makeGroup(entry.children)   // deshacer: rehacer el grupo
          redoHistory.current.push(entry)
        } else if (entry.type === 'transform') {
          const cur = entry.items.map(it => ({ obj: it.obj, left: it.obj.left ?? 0, top: it.obj.top ?? 0 }))
          entry.items.forEach(it => { it.obj.set({ left: it.left, top: it.top }); it.obj.setCoords() })
          redoHistory.current.push({ type: 'transform', items: cur })
        } else if (entry.type === 'fillBatch') {
          const cur = entry.items.map(it => ({ obj: it.obj, prevFill: it.obj.fill as fabric.TFiller | string | null }))
          entry.items.forEach(it => it.obj.set({ fill: it.prevFill as string, dirty: true }))
          redoHistory.current.push({ type: 'fillBatch', items: cur })
        } else {
          const curFill = entry.obj.fill
          entry.obj.set({ fill: entry.prevFill as string })
          redoHistory.current.push({ type: 'fill', obj: entry.obj, prevFill: curFill as fabric.TFiller | string | null })
        }
        canvas.discardActiveObject()
        canvas.requestRenderAll()
      }
    }

    // Paste images from system clipboard (Ctrl+V with image)
    const onPaste = (e: ClipboardEvent) => {
      const canvas = fc.current
      if (!canvas) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          fabric.FabricImage.fromURL(url).then((img: fabric.FabricImage) => {
            const maxSide = 400
            const w = img.width ?? 100
            const h = img.height ?? 100
            if (w > maxSide || h > maxSide) img.scale(maxSide / Math.max(w, h))
            img.set({ left: 100, top: 100, selectable: true, evented: true })
            canvas.add(img)
            canvas.setActiveObject(img)
            canvas.requestRenderAll()
            undoHistory.current.push({ type: 'add', obj: img })
            redoHistory.current = []
          })
          break
        }
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  function handleSave() {
    const canvas = fc.current
    if (!canvas) return
    const userObjs = canvas.getObjects()
      .filter(o => !(o as any)._rawMockup)
      .map(o => { const j = o.toObject(['_texture']); delete j.clipPath; return j })
    const canvasJson = JSON.stringify(userObjs)
    const thumbnail = canvas.toDataURL({ format: 'png', multiplier: 0.3 })
    onSave(thumbnail, canvasJson)
    onSaveComplete()
  }

  function handleExport() {
    const canvas = fc.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL({ format: 'png', multiplier: 2 })
    a.download = `${project.name}.png`
    a.click()
  }

  // Genera un snapshot de la prenda (recortado al mockup) y abre el Tech Pack
  function openTechPack() {
    const canvas = fc.current
    if (!canvas) return
    canvas.discardActiveObject()
    const wasMeasure = measureEditRef.current
    measureEditRef.current = false  // que no salgan los tiradores en la foto
    canvas.requestRenderAll()
    let opts: any = { format: 'png', multiplier: 2 }
    const mocks = mockupObjects.current
    if (mocks.length) {
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
      mocks.forEach(o => { const bb = o.getBoundingRect(); l = Math.min(l, bb.left); t = Math.min(t, bb.top); r = Math.max(r, bb.left + bb.width); b = Math.max(b, bb.top + bb.height) })
      const pad = 20
      opts = { ...opts, left: Math.max(0, l - pad), top: Math.max(0, t - pad), width: (r - l) + pad * 2, height: (b - t) + pad * 2 }
    }
    const img = canvas.toDataURL(opts)
    measureEditRef.current = wasMeasure
    onOpenTechPack(img, isTee ? measures : null)
  }

  function resetView() {
    const canvas = fc.current
    if (!canvas) return
    canvas.setZoom(1)
    canvas.absolutePan(new fabric.Point(0, 0))
    canvas.requestRenderAll()
    setZoom(1)
    setPanned(false)
  }

  // ── Remera paramétrica: (re)genera el mockup desde las medidas en cm ─────────
  function placeTee(m: Measures, reassignClip = false) {
    const canvas = fc.current
    if (!canvas) return
    const CW = canvas.getWidth(), CH = canvas.getHeight()
    mockupObjects.current.forEach(o => canvas.remove(o))

    const shapes = buildTeeShapes(m)
    const objs = shapes.map(s => {
      const p = new fabric.Path(s.d, {
        fill: s.fill ?? null, stroke: s.stroke, strokeWidth: s.strokeWidth,
        selectable: false, evented: true, hoverCursor: 'crosshair', strokeUniform: true,
      })
      ;(p as any)._rawMockup = true
      return p
    })
    // Escala FIJA calculada con las medidas por defecto (una sola vez): así al cambiar
    // una medida el tamaño en pantalla refleja los cm reales (alargar = más largo, no más fino).
    if (!teeFitRef.current) {
      const dObjs = buildTeeShapes(DEFAULT_MEASURES).map(s => new fabric.Path(s.d))
      const dL = dObjs.map(o => o.left ?? 0), dT = dObjs.map(o => o.top ?? 0)
      const dR = dObjs.map(o => (o.left ?? 0) + (o.width ?? 0)), dB = dObjs.map(o => (o.top ?? 0) + (o.height ?? 0))
      const bx = Math.min(...dL), by = Math.min(...dT)
      const bw = Math.max(...dR) - bx, bh = Math.max(...dB) - by
      const pad = Math.min(CW, CH) * 0.12
      const sc0 = Math.min((CW - pad * 2) / bw, (CH - pad * 2) / bh)
      teeFitRef.current = { sc: sc0, ox: (CW - bw * sc0) / 2 - bx * sc0, oy: (CH - bh * sc0) / 2 - by * sc0 }
    }
    const { sc, ox, oy } = teeFitRef.current
    objs.forEach(o => o.set({ left: (o.left ?? 0) * sc + ox, top: (o.top ?? 0) * sc + oy, scaleX: sc, scaleY: sc }))
    objs.forEach(o => canvas.add(o))
    mockupObjects.current = objs

    // Clip = unión de todas las piezas (cuerpo + mangas)
    const clipObjs = shapes.filter(s => s.role === 'piece').map(s => {
      const p = new fabric.Path(s.d, { fill: '#000' })
      p.set({ left: (p.left ?? 0) * sc + ox, top: (p.top ?? 0) * sc + oy, scaleX: sc, scaleY: sc })
      return p
    })
    const cg = new fabric.Group(clipObjs); cg.absolutePositioned = true
    clipPath.current = cg
    pxPerCmRef.current = sc

    for (let i = objs.length - 1; i >= 0; i--) canvas.sendObjectToBack(objs[i])
    if (reassignClip) {
      canvas.getObjects().forEach(o => {
        if (mockupObjects.current.includes(o) || o instanceof fabric.IText) return
        o.clipPath = clipEnabledRef.current ? cg : undefined
        o.dirty = true
      })
    }
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  function applyMeasures(next: Measures) {
    measuresRef.current = next
    setMeasures(next)
    placeTee(next, true)
  }
  function updateMeasure(key: keyof Measures, val: number) {
    applyMeasures({ ...measuresRef.current, [key]: val })
  }
  // Edición "en general" de un grupo colapsado: escala todas sus medidas a la par.
  function updateGroupGeneral(group: { keys: (keyof Measures)[] }, mainVal: number) {
    const main = group.keys[0]
    const oldMain = measuresRef.current[main] || 1
    const ratio = mainVal / oldMain
    const next = { ...measuresRef.current }
    for (const k of group.keys) {
      const fld = MEASURE_FIELDS.find(f => f.key === k)!
      const raw = k === main ? mainVal : measuresRef.current[k] * ratio
      next[k] = Math.round(Math.min(fld.max, Math.max(fld.min, raw)) * 10) / 10
    }
    applyMeasures(next)
  }

  // ── Clip toggle: mostrar/ocultar lo que está fuera de la remera ──────────────
  function toggleClip() {
    const canvas = fc.current
    if (!canvas) return
    const next = !clipEnabled
    setClipEnabled(next)
    clipEnabledRef.current = next
    canvas.getObjects().forEach(obj => {
      if (mockupObjects.current.includes(obj)) return
      if (obj instanceof fabric.IText) return  // el texto nunca se recorta
      obj.clipPath = next ? (clipPath.current ?? undefined) : undefined
      // Fabric cachea el render del objeto; sin marcar dirty reusa la versión recortada
      obj.dirty = true
    })
    canvas.requestRenderAll()
  }

  // ── Bloqueo del mockup ───────────────────────────────────────────────────────
  function toggleMockupLock() {
    const canvas = fc.current
    if (!canvas) return
    const next = !mockupLocked
    setMockupLocked(next)
    mockupLockedRef.current = next
    const unlocked = !next
    mockupObjects.current.forEach(o => {
      o.set({
        selectable: unlocked && tool === 'select',
        evented:    tool === 'fill' || (unlocked && (tool === 'select' || tool === 'curve')),
      })
    })
    if (next) canvas.discardActiveObject()  // al bloquear, soltar selección de piezas del mockup
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  // Habilita/inhabilita seleccionar piezas de la prenda para pintarlas de a una.
  // (Igual que el lock del mockup, pero fuerza la herramienta de selección y no
  //  depende del estado `tool` para marcar las piezas como seleccionables.)
  function togglePiecePaint() {
    const canvas = fc.current
    if (!canvas) return
    const unlocked = mockupLocked   // si estaba bloqueado, ahora lo desbloqueamos
    const next = !unlocked
    setMockupLocked(next)
    mockupLockedRef.current = next
    setTool('select')
    mockupObjects.current.forEach(o => o.set({ selectable: unlocked, evented: true }))
    if (next) canvas.discardActiveObject()
    canvas.requestRenderAll()
    refreshLayersNow()
    onToast?.(unlocked ? 'Tocá una pieza de la prenda para pintarla' : 'Prenda bloqueada')
  }

  function selectMockupShape(obj: fabric.FabricObject) {
    const canvas = fc.current
    if (!canvas || mockupLocked) return
    setTool('select')
    obj.set({ selectable: true, evented: true })
    canvas.setActiveObject(obj)
    setSelectedObj(obj)
    canvas.requestRenderAll()
  }

  // ── Agrupar / desagrupar ─────────────────────────────────────────────────────
  // Helpers reutilizables (también para undo/redo). Asumen coords absolutas en los hijos.
  function makeGroup(children: fabric.FabricObject[]): fabric.Group {
    const canvas = fc.current!
    children.forEach(o => canvas.remove(o))
    const group = new fabric.Group(children, { selectable: true, evented: true })
    canvas.add(group)
    return group
  }
  function dissolveGroup(group: fabric.Group): fabric.FabricObject[] {
    const canvas = fc.current!
    const children = group.removeAll() as fabric.FabricObject[]
    canvas.remove(group)
    children.forEach(o => { o.set({ selectable: true, evented: true }); canvas.add(o) })
    return children
  }

  function groupSelection() {
    const canvas = fc.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active || active.type !== 'activeselection') return
    const children = (active as fabric.ActiveSelection).getObjects()
      .filter(o => !mockupObjects.current.includes(o))
    if (children.length < 2) return
    canvas.discardActiveObject()  // restaura coords absolutas
    const group = makeGroup(children)
    canvas.setActiveObject(group)
    undoHistory.current.push({ type: 'group', children, group })
    redoHistory.current = []
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  function ungroupSelection() {
    const canvas = fc.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active || active.type !== 'group') return
    ungroupTarget(active as fabric.Group)
  }

  // Desagrupa un grupo concreto (sirve para botón, atajo y menú contextual).
  function ungroupTarget(group: fabric.Group) {
    const canvas = fc.current
    if (!canvas) return
    const children = dissolveGroup(group)
    const sel = new fabric.ActiveSelection(children, { canvas })
    canvas.setActiveObject(sel)
    undoHistory.current.push({ type: 'ungroup', children, group })
    redoHistory.current = []
    canvas.requestRenderAll()
    refreshLayersNow()
    onToast?.((group as any)._garmentGroup ? 'Prenda desagrupada' : 'Desagrupado')
  }

  // ¿La prenda está agrupada en una "madre"?
  function garmentGroupObj(): fabric.Group | null {
    const canvas = fc.current
    return (canvas?.getObjects().find(o => (o as any)._garmentGroup) as fabric.Group) ?? null
  }

  // Agrupa TODAS las piezas de la prenda en un único grupo "madre".
  function groupGarment() {
    const canvas = fc.current
    if (!canvas || garmentGroupObj()) return
    const pieces = mockupObjects.current.filter(o => canvas.getObjects().includes(o))
    if (pieces.length < 2) return
    setMockupLocked(false); mockupLockedRef.current = false
    canvas.discardActiveObject()
    pieces.forEach(o => o.set({ selectable: true, evented: true }))
    const group = makeGroup(pieces)
    ;(group as any)._garmentGroup = true
    canvas.setActiveObject(group)
    undoHistory.current.push({ type: 'group', children: pieces, group })
    redoHistory.current = []
    canvas.requestRenderAll()
    refreshLayersNow()
    onToast?.('Prenda agrupada — click derecho para elegir una pieza')
  }

  // Selecciona una pieza puntual de la prenda (desde el menú contextual). Si la
  // prenda está agrupada, primero la desagrupa para poder editar la pieza sola.
  function selectPieceFromMenu(piece: fabric.FabricObject) {
    const canvas = fc.current
    if (!canvas) return
    const g = garmentGroupObj()
    if (g && g.getObjects().includes(piece)) dissolveGroup(g)
    setMockupLocked(false); mockupLockedRef.current = false
    setTool('select')
    piece.set({ selectable: true, evented: true })
    canvas.setActiveObject(piece)
    setSelectedObj(piece)
    canvas.requestRenderAll()
    refreshLayersNow()
    onToast?.(`${pieceNameOf(piece, 'Pieza')} seleccionada`)
  }

  // ── Menú contextual (click derecho) ──────────────────────────────────────────
  function openContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const canvas = fc.current
    if (!canvas) return
    let target = canvas.getActiveObject() as fabric.FabricObject | null
    if (!target) {
      const pt = canvas.getScenePoint(e.nativeEvent)
      const pieces = mockupObjects.current
      for (let i = pieces.length - 1; i >= 0; i--) {
        if (pieces[i].visible !== false && pieces[i].containsPoint(pt)) { target = pieces[i]; break }
      }
      if (!target) target = (canvas.findTarget(e.nativeEvent) as fabric.FabricObject) ?? null
    }
    setCtxMenu({
      x: e.clientX, y: e.clientY, target,
      isGroup: !!target && target.type === 'group',
      isMulti: !!target && target.type === 'activeselection',
    })
  }
  const closeCtx = () => setCtxMenu(null)

  // ── Acciones del panel de capas ─────────────────────────────────────────────
  function refreshLayersNow() {
    const canvas = fc.current
    if (canvas) setLayers([...canvas.getObjects()])
    setLayersVersion(v => v + 1)
  }

  function toggleLayerVisible(obj: fabric.FabricObject) {
    obj.visible = !obj.visible
    if (!obj.visible && obj === fc.current?.getActiveObject()) {
      fc.current?.discardActiveObject()
    }
    fc.current?.requestRenderAll()
    refreshLayersNow()
  }

  function toggleLayerLock(obj: fabric.FabricObject) {
    const locked = !((obj as any)._locked)
    ;(obj as any)._locked = locked
    obj.selectable = !locked && tool === 'select'
    obj.evented    = !locked
    if (locked && obj === fc.current?.getActiveObject()) {
      fc.current?.discardActiveObject()
    }
    fc.current?.requestRenderAll()
    refreshLayersNow()
  }

  function moveLayer(obj: fabric.FabricObject, dir: 'up' | 'down') {
    const canvas = fc.current
    if (!canvas) return
    const objs = canvas.getObjects()
    const idx  = objs.indexOf(obj)
    const minIdx = mockupObjects.current.length  // mantener objetos por encima del mockup
    if (dir === 'up' && idx < objs.length - 1) canvas.bringObjectForward(obj)
    if (dir === 'down' && idx > minIdx)        canvas.sendObjectBackwards(obj)
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  // Arrastrar una capa sobre otra en el panel: mueve el objeto a esa posición Z
  function reorderLayerTo(from: fabric.FabricObject, to: fabric.FabricObject) {
    const canvas = fc.current
    if (!canvas || from === to) return
    if (mockupObjects.current.includes(from) || mockupObjects.current.includes(to)) return
    let toIdx = canvas.getObjects().indexOf(to)
    const minIdx = mockupObjects.current.length
    toIdx = Math.max(minIdx, toIdx)  // nunca por debajo del mockup
    canvas.moveObjectTo(from, toIdx)
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  // Orden Z del objeto seleccionado (siempre por encima del mockup)
  function reorderSelected(dir: 'front' | 'forward' | 'backward' | 'back') {
    const canvas = fc.current
    if (!canvas) return
    const obj = canvas.getActiveObject()
    if (!obj || mockupObjects.current.includes(obj)) return
    const minIdx = mockupObjects.current.length
    const idx = canvas.getObjects().indexOf(obj)
    if (dir === 'front') canvas.bringObjectToFront(obj)
    else if (dir === 'forward') { if (idx < canvas.getObjects().length - 1) canvas.bringObjectForward(obj) }
    else if (dir === 'backward') { if (idx > minIdx) canvas.sendObjectBackwards(obj) }
    else { // back: al fondo pero por encima del mockup
      canvas.sendObjectToBack(obj)
      for (let i = mockupObjects.current.length - 1; i >= 0; i--) canvas.sendObjectToBack(mockupObjects.current[i])
    }
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  function deleteLayer(obj: fabric.FabricObject) {
    const canvas = fc.current
    if (!canvas) return
    undoHistory.current.push({ type: 'remove', obj })
    redoHistory.current = []
    if (obj === canvas.getActiveObject()) canvas.discardActiveObject()
    canvas.remove(obj)
    canvas.requestRenderAll()
    refreshLayersNow()
  }

  const viewChanged = Math.abs(zoom - 1) > 0.01 || panned

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)', overflow: 'hidden' }}>
        {/* Left tool dock */}
        <aside style={{
          width: 44, flexShrink: 0, borderRight: '1px solid var(--line-soft)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '8px 4px', gap: 2, background: 'var(--bg)',
        }}>
          <ToolBtn icon={<IconSelect />} label="Seleccionar (V)"  active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolDivider />
          <ToolBtn icon={<IconPen />} label="Pluma (P)"           active={tool === 'pen'}   onClick={() => setTool('pen')} />
          <ToolBtn icon={<IconCurve />} label="Pluma curvatura"   active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon={<IconPencil />} label="Lápiz (N)"        active={tool === 'pencil'} onClick={() => setTool('pencil')} />
          <ToolBtn icon={<IconText />} label="Texto (T)"          active={tool === 'text'}   onClick={() => setTool('text')} />
          <ToolDivider />
          <ToolBtn icon={<IconRect />} label="Rectángulo (M)"     active={tool === 'rect'}    onClick={() => setTool('rect')} />
          <ToolBtn icon={<IconEllipse />} label="Elipse (L)"      active={tool === 'ellipse'} onClick={() => setTool('ellipse')} />
          <ToolBtn icon={<IconLine />} label="Línea (\)"          active={tool === 'line'}    onClick={() => setTool('line')} />
          <ToolDivider />
          <ToolBtn icon={<IconBucket />} label="Relleno"          active={tool === 'fill'}        onClick={() => setTool('fill')} />
          <ToolBtn icon={<IconEyedropper />} label="Gotero (I)"   active={tool === 'eyedropper'} onClick={() => setTool('eyedropper')} />
          <ToolBtn icon={<IconEraser />} label="Goma"             active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <div style={{ marginTop: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <ToolDivider />
            <ToolBtn icon={<IconHand />} label="Mano · pan (H · Espacio)" active={tool === 'hand'} onClick={() => setTool('hand')} />
            <ToolBtn icon={<IconZoom />} label="Zoom (Z · Alt aleja)"     active={tool === 'zoom'} onClick={() => setTool('zoom')} />
          </div>
        </aside>

        {/* Canvas */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-2)' }}
          ref={canvasAreaRef as RefObject<HTMLElement>}
          onContextMenu={openContextMenu}
          onDragEnter={e => { e.preventDefault(); if (Array.from(e.dataTransfer.types).includes('Files')) setDragActive(true) }}
          onDragOver={e => { e.preventDefault() }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDragActive(false) }}
          onDrop={e => {
            e.preventDefault()
            setDragActive(false)
            const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/'))
            if (f) handlePlaceImage(f)
          }}
        >
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(circle, var(--line-soft) 1px, transparent 1px)',
            backgroundSize: '20px 20px', opacity: 0.4,
          }} />
          <canvas ref={canvasEl} />
          <div ref={cursorRef} className="editor-size-cursor" />

          {/* Overlay al arrastrar una imagen */}
          {dragActive && (
            <div style={{
              position: 'absolute', inset: 12, zIndex: 40, pointerEvents: 'none',
              border: '2px dashed var(--accent)', borderRadius: 14,
              background: 'color-mix(in oklch, var(--accent) 8%, rgb(0 0 0 / 0.35))',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 34 }}>🖼️</span>
              <span style={{ color: 'var(--fg)', fontSize: 15, fontFamily: 'var(--ui)' }}>Soltá la imagen para importarla</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>sin abrir el explorador · no sale de pantalla completa</span>
            </div>
          )}

          {/* Toggle: recortar / mostrar lo que está fuera de la remera */}
          <button
            onClick={toggleClip}
            title={clipEnabled ? 'Mostrar lo que está fuera de la remera' : 'Recortar a la remera (ocultar lo de afuera)'}
            style={{
              position: 'absolute', top: 14, left: 14, zIndex: 20,
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'var(--bg)',
              border: '1px solid ' + (clipEnabled ? 'var(--line)' : 'var(--accent)'),
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'var(--ui)', fontSize: 11,
              color: clipEnabled ? 'var(--fg-2)' : 'var(--accent)',
              boxShadow: 'var(--shadow-lg)',
              transition: 'all 0.15s var(--ease)',
            }}
          >
            <span style={{ fontSize: 13 }}>{clipEnabled ? '✂️' : '👁'}</span>
            <span>{clipEnabled ? 'Recortado a la remera' : 'Mostrando todo'}</span>
          </button>
          {vectorizing && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              <div style={{ width: 32, height: 32, border: '3px solid #555', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ color: '#fff', fontSize: 13 }}>Procesando imagen...</span>
            </div>
          )}
          {viewChanged && (
            <button
              onClick={resetView}
              title="Restablecer zoom y posición"
              style={{
                position: 'absolute', bottom: 16, right: 16,
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
                fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg)',
                boxShadow: 'var(--shadow-lg)',
                animation: 'rise 0.2s var(--ease) both',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg)' }}
            >
              <span style={{ fontSize: 13 }}>⊙</span>
              <span>{Math.round(zoom * 100)}%</span>
              <span style={{ color: 'var(--muted)', marginLeft: 2 }}>· restablecer</span>
            </button>
          )}
          {(tool === 'pen' || tool === 'curve' || tool === 'text') && (
            <div style={{
              position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
              background: 'rgb(0 0 0 / 0.7)', color: '#fff', fontSize: 11,
              padding: '6px 14px', borderRadius: 999, backdropFilter: 'blur(8px)',
              pointerEvents: 'none', whiteSpace: 'nowrap', fontFamily: 'var(--mono)',
            }}>
              {tool === 'pen'   && 'Click · agregar  |  Alt+arrastrar · ángulo libre  |  Click ancla · seleccionar  |  Supr · eliminar  |  Enter · terminar'}
              {tool === 'curve' && 'Click ancla · seleccionar  |  Arrastrar · mover  |  Supr · eliminar ancla'}
              {tool === 'text'  && 'Click en el canvas para colocar texto'}
            </div>
          )}
        </main>

        {/* Right panel — redimensionable arrastrando el borde izquierdo (estilo Illustrator) */}
        <aside ref={rightPanelRef as RefObject<HTMLElement>} style={{
          width: rightPanelW, flexShrink: 0, borderLeft: '1px solid var(--line-soft)',
          display: 'flex', flexDirection: 'column', background: 'var(--bg)',
          position: 'relative',
        }}>
          {/* Tirador de redimensión: franja fina sobre el borde izquierdo */}
          <div
            onPointerDown={startPanelResize}
            onDoubleClick={() => { if (rightPanelRef.current) rightPanelRef.current.style.width = '232px'; setRightPanelW(232); localStorage.setItem('raw.rightPanelW', '232') }}
            title="Arrastrar para cambiar el ancho · doble click para restablecer"
            style={{
              position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, zIndex: 30,
              cursor: 'col-resize', touchAction: 'none',
              background: resizingPanel ? 'var(--accent)' : 'transparent',
              transition: 'background 0.12s var(--ease)',
            }}
            onMouseEnter={e => { if (!resizingPanel) e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 45%, transparent)' }}
            onMouseLeave={e => { if (!resizingPanel) e.currentTarget.style.background = 'transparent' }}
          />
          {/* Tabs */}
          <div style={{
            display: 'flex', flexShrink: 0,
            borderBottom: '1px solid var(--line-soft)',
          }}>
            {(['props', 'layers', 'textures'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1, height: 36, border: 'none', borderRadius: 0, cursor: 'pointer',
                  background: rightTab === tab ? 'var(--surface)' : 'transparent',
                  borderBottom: '2px solid ' + (rightTab === tab ? 'var(--accent)' : 'transparent'),
                  color: rightTab === tab ? 'var(--fg)' : 'var(--muted)',
                  fontSize: 11, fontFamily: 'var(--ui)', letterSpacing: '0.04em',
                  transition: 'all 0.15s var(--ease)',
                }}
              >
                {tab === 'props' ? 'Propiedades' : tab === 'layers' ? 'Capas' : 'Texturas'}
              </button>
            ))}
          </div>

          {/* Properties tab */}
          {rightTab === 'props' && <div style={{ overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          {PARAMETRIC_TEE && isTee && !hasSel && (() => {
            const cmInput = (val: number, min: number, max: number, onCh: (v: number) => void) => (
              <div onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                <NumberField value={val} onChange={onCh} min={min} max={max} step={0.5} suffix="cm" width={60} />
              </div>
            )
            return (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Medidas de la prenda (cm)</div>
              <button
                onClick={() => setMeasureEdit(v => !v)}
                title="Arrastrar puntos sobre la remera para cambiar las medidas"
                style={{
                  width: '100%', justifyContent: 'center', marginBottom: 10, fontSize: 11,
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  background: measureEdit ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
                  border: '1px solid ' + (measureEdit ? 'var(--accent)' : 'var(--line)'),
                  color: measureEdit ? 'var(--accent)' : 'var(--fg-2)', fontFamily: 'var(--ui)',
                }}
              >
                {measureEdit ? '✋ Arrastrando medidas (tocá para salir)' : '✋ Ajustar arrastrando en la remera'}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {MEASURE_GROUPS.map(g => {
                  const single = g.keys.length === 1
                  const open = !!openGroups[g.id]
                  const mainFld = MEASURE_FIELDS.find(f => f.key === g.keys[0])!
                  return (
                    <div key={g.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 8, overflow: 'hidden' }}>
                      <div
                        onClick={() => { if (!single) setOpenGroups(p => ({ ...p, [g.id]: !p[g.id] })) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                          cursor: single ? 'default' : 'pointer', background: 'var(--surface)' }}
                      >
                        {!single && <span style={{ fontSize: 9, width: 10, transition: 'transform 0.15s', transform: open ? 'none' : 'rotate(-90deg)' }}>▾</span>}
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--ui)' }}>{g.label}</span>
                        {/* Colapsado: editar en general (escala todo el grupo) */}
                        {(single || !open) && cmInput(measures[g.keys[0]], mainFld.min, mainFld.max,
                          v => single ? updateMeasure(g.keys[0], v) : updateGroupGeneral(g, v))}
                      </div>
                      {!single && open && (
                        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {g.keys.map(k => {
                            const fld = MEASURE_FIELDS.find(f => f.key === k)!
                            return (
                              <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--ui)' }}>{fld.label}</span>
                                {cmInput(measures[k], fld.min, fld.max, v => updateMeasure(k, v))}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => { measuresRef.current = DEFAULT_MEASURES; setMeasures(DEFAULT_MEASURES); placeTee(DEFAULT_MEASURES, true) }}
                style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 11 }}
              >
                Restablecer medidas
              </button>
            </div>
            )
          })()}
          {/* Agrupar / Desagrupar — botones con especificación clara */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selKind === 'multi' && (
              <button className="btn btn-ghost" onClick={groupSelection} style={{ justifyContent: 'center', fontSize: 12 }}>
                ⊞ Agrupar selección <span style={{ color: 'var(--muted)', marginLeft: 6 }}>Ctrl+G</span>
              </button>
            )}
            {selKind === 'group' && (
              <button className="btn btn-ghost" onClick={ungroupSelection} style={{ justifyContent: 'center', fontSize: 12 }}>
                ⊟ Desagrupar <span style={{ color: 'var(--muted)', marginLeft: 6 }}>Ctrl+Shift+G</span>
              </button>
            )}
            {mockupObjects.current.length > 1 && !garmentGroupObj() && (
              <button className="btn btn-ghost" onClick={groupGarment} style={{ justifyContent: 'center', fontSize: 12 }}>
                ⊞ Agrupar prenda
              </button>
            )}
            {garmentGroupObj() && (
              <button className="btn btn-ghost" onClick={() => { const g = garmentGroupObj(); if (g) ungroupTarget(g) }} style={{ justifyContent: 'center', fontSize: 12 }}>
                ⊟ Desagrupar prenda
              </button>
            )}
          </div>
          {hasSel && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Orden</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
                {([
                  ['⤒', 'Traer al frente', 'front'],
                  ['↑', 'Traer adelante', 'forward'],
                  ['↓', 'Enviar atrás', 'backward'],
                  ['⤓', 'Enviar al fondo', 'back'],
                ] as const).map(([ic, title, dir]) => (
                  <button key={dir} title={title} onClick={() => reorderSelected(dir)}
                    style={{ padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 14,
                      background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg-2)' }}
                  >{ic}</button>
                ))}
              </div>
            </div>
          )}
          {selectedObj?.type === 'image' && (
            <button
              className="btn btn-ghost"
              onClick={removeBackground}
              title="Quitar el fondo de la imagen (fondos lisos)"
              style={{ justifyContent: 'center', fontSize: 12 }}
            >
              ✂️ Quitar fondo
            </button>
          )}
          {isText && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Tipografía</div>

              {/* Font picker trigger */}
              <button
                onClick={() => { setFontPickerOpen(v => !v); setFontFilter('') }}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8, marginBottom: 4,
                  background: 'var(--surface)', border: '1px solid ' + (fontPickerOpen ? 'var(--accent)' : 'var(--line)'),
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  textAlign: 'left', transition: 'border-color 0.15s var(--ease)',
                }}
              >
                <span style={{ fontFamily: propFontFamily, fontSize: 15, color: 'var(--fg)' }}>{propFontFamily}</span>
                <span style={{ fontFamily: 'var(--ui)', fontSize: 10, color: 'var(--muted)' }}>
                  {fontLoading ? '…' : fontPickerOpen ? '▴' : '▾'}
                </span>
              </button>

              {/* Font dropdown */}
              {fontPickerOpen && (
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8,
                  overflow: 'hidden', marginBottom: 8,
                }}>
                  <input
                    value={fontFilter}
                    onChange={e => setFontFilter(e.target.value)}
                    placeholder="Buscar fuente..."
                    autoFocus
                    style={{
                      width: '100%', padding: '7px 10px', borderRadius: 0, border: 'none',
                      borderBottom: '1px solid var(--line-soft)',
                      background: 'var(--surface)', color: 'var(--fg)',
                      fontFamily: 'var(--ui)', fontSize: 12, outline: 'none',
                    }}
                  />
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    <FontSection label="Sistema"      fonts={SYSTEM_FONTS} filter={fontFilter} selected={propFontFamily} onSelect={handleFontSelect} />
                    <FontSection label="Google Fonts" fonts={GOOGLE_FONTS} filter={fontFilter} selected={propFontFamily} onSelect={handleFontSelect} />
                    {/* User fonts */}
                    {(userFonts.length > 0 || !fontFilter) && (
                      <div style={{ borderTop: '1px solid var(--line-soft)' }}>
                        <div style={{ padding: '6px 10px 2px', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                          Mis fuentes
                        </div>
                        {userFonts
                          .filter(f => !fontFilter || f.toLowerCase().includes(fontFilter.toLowerCase()))
                          .map(f => (
                            <div key={f} style={{ display: 'flex', alignItems: 'center' }}>
                              <FontRow name={f} selected={propFontFamily === f} onClick={() => handleFontSelect(f)} />
                              <button
                                onClick={e => handleDeleteUserFont(f, e)}
                                style={{
                                  flexShrink: 0, padding: '0 8px', height: 34, border: 'none',
                                  background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 11,
                                }}
                                title="Eliminar fuente"
                              >✕</button>
                            </div>
                          ))
                        }
                        <button
                          onClick={() => fontFileRef.current?.click()}
                          style={{
                            width: '100%', padding: '8px 10px', border: 'none',
                            background: 'none', color: 'var(--accent)', fontSize: 11,
                            cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui)',
                          }}
                        >
                          + Subir fuente (.ttf .otf .woff .woff2)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Font size */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span className="label">Tamaño</span>
                <NumberField value={propFontSize} onChange={applyFontSize} min={6} max={400} step={1} suffix="px" />
              </div>
            </div>
          )}

          {/* Transformar */}
          {hasSel && (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Transformar</div>
              {/* X / Y */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                {([['X', propX, applyX], ['Y', propY, applyY]] as const).map(([label, val, fn]) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3, fontFamily: 'var(--ui)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
                    <NumberField value={val} onChange={fn} step={1} fullWidth />
                  </div>
                ))}
              </div>
              {/* W / H */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                {([['W', propW, applyW], ['H', propH, applyH]] as const).map(([label, val, fn]) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3, fontFamily: 'var(--ui)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
                    <NumberField value={val} onChange={fn} step={1} min={1} fullWidth />
                  </div>
                ))}
              </div>
              {/* Rotación */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label">Rotación</span>
                <NumberField value={propAngle} onChange={applyAngle} step={1} min={-360} max={360} suffix="°" />
              </div>
              {/* Opacidad */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="label">Opacidad</span>
                  <NumberField value={propOpacity} onChange={applyOpacity} step={1} min={0} max={100} suffix="%" />
                </div>
                <input type="range" min={0} max={100} step={1} value={propOpacity}
                  onChange={e => applyOpacity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }} />
              </div>
            </div>
          )}

          {/* Alinear */}
          {hasSel && (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Alinear</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                <AlignBtn title="Alinear a la izquierda"  onClick={() => alignObjects('left')}><AlignGlyph dir="left" /></AlignBtn>
                <AlignBtn title="Centrar horizontal"      onClick={() => alignObjects('hcenter')}><AlignGlyph dir="hcenter" /></AlignBtn>
                <AlignBtn title="Alinear a la derecha"    onClick={() => alignObjects('right')}><AlignGlyph dir="right" /></AlignBtn>
                <AlignBtn title="Alinear arriba"          onClick={() => alignObjects('top')}><AlignGlyph dir="top" /></AlignBtn>
                <AlignBtn title="Centrar vertical"        onClick={() => alignObjects('vmiddle')}><AlignGlyph dir="vmiddle" /></AlignBtn>
                <AlignBtn title="Alinear abajo"           onClick={() => alignObjects('bottom')}><AlignGlyph dir="bottom" /></AlignBtn>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginTop: 4 }}>
                <AlignBtn title="Distribuir horizontal (3+ objetos)" onClick={() => distributeObjects('h')}><AlignGlyph dir="disth" /></AlignBtn>
                <AlignBtn title="Distribuir vertical (3+ objetos)"   onClick={() => distributeObjects('v')}><AlignGlyph dir="distv" /></AlignBtn>
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--ui)' }}>
                {selKind === 'multi' ? 'Entre los objetos seleccionados' : 'Respecto a la remera'}
              </div>
            </div>
          )}

          {/* Pathfinder (2+ objetos) */}
          {selKind === 'multi' && (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Pathfinder</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                <AlignBtn title="Unir"      onClick={() => pathfinder('unite')}><PathfinderGlyph op="unite" /></AlignBtn>
                <AlignBtn title="Restar frente" onClick={() => pathfinder('subtract')}><PathfinderGlyph op="subtract" /></AlignBtn>
                <AlignBtn title="Intersecar" onClick={() => pathfinder('intersect')}><PathfinderGlyph op="intersect" /></AlignBtn>
                <AlignBtn title="Excluir"   onClick={() => pathfinder('exclude')}><PathfinderGlyph op="exclude" /></AlignBtn>
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--ui)' }}>
                Combina las formas en un trazado nuevo
              </div>
            </div>
          )}

          {/* Relleno */}
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Relleno</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {propFill !== null ? (
                <>
                  <label style={{ position: 'relative', cursor: 'pointer' }}>
                    <input type="color" value={propFill} onChange={e => applyFill(e.target.value)}
                      style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, background: propFill,
                      border: '2px solid var(--line)', cursor: 'pointer',
                    }} />
                  </label>
                  <span className="mono" style={{ fontSize: 11, flex: 1, color: 'var(--fg-2)' }}>{propFill}</span>
                  <button onClick={() => applyFill(null)} style={{
                    background: 'none', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: 12, padding: 4,
                  }}>✕</button>
                </>
              ) : (
                <button className="btn btn-ghost" onClick={() => applyFill('#ffffff')} style={{ padding: '5px 10px', fontSize: 12 }}>
                  + color
                </button>
              )}
            </div>
          </div>

          {/* Trazado */}
          <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
            <div className="label" style={{ marginBottom: 8 }}>Trazado</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ position: 'relative', cursor: 'pointer' }}>
                <input type="color" value={propStroke} onChange={e => applyStroke(e.target.value)}
                  style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                <div style={{
                  width: 32, height: 32, borderRadius: 8, background: propStroke,
                  border: '2px solid var(--line)', cursor: 'pointer',
                }} />
              </label>
              <span className="mono" style={{ fontSize: 11, flex: 1, color: 'var(--fg-2)' }}>{propStroke}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="label">Grosor</span>
              <NumberField value={propSWidth} mixed={propSWidthMixed} onChange={applyStrokeWidth}
                min={0.5} max={200} step={0.5} suffix="px" />
            </div>

            {/* Estilo de trazado especial — se aplica a lo que dibujes con lápiz o pluma */}
            <div style={{ marginTop: 12 }}>
              <span className="label" style={{ display: 'block', marginBottom: 6 }}>Estilo</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { id: 'normal',   label: 'Normal',  icon: <StrokeStyleIcon kind="normal" /> },
                  { id: 'bordado',  label: 'Bordado', icon: <StrokeStyleIcon kind="bordado" /> },
                  { id: 'cierre',   label: 'Cierre',  icon: <StrokeStyleIcon kind="cierre" /> },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setStrokeStyle(opt.id)}
                    title={`Trazado ${opt.label.toLowerCase()}`}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '7px 4px', borderRadius: 7, cursor: 'pointer',
                      background: strokeStyle === opt.id ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
                      border: '1px solid ' + (strokeStyle === opt.id ? 'var(--accent)' : 'var(--line)'),
                      color: strokeStyle === opt.id ? 'var(--accent)' : 'var(--fg-2)',
                      transition: 'all 0.15s var(--ease)',
                    }}
                  >
                    {opt.icon}
                    <span style={{ fontSize: 9.5, fontFamily: 'var(--ui)' }}>{opt.label}</span>
                  </button>
                ))}
              </div>
              {strokeStyle !== 'normal' && (
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 7, lineHeight: 1.4 }}>
                  Dibujá con el lápiz o la pluma y el trazo se reemplaza por {strokeStyle === 'bordado' ? 'puntadas de bordado' : 'un cierre'}.
                </p>
              )}
            </div>
          </div>

          {hasSel && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>· objeto seleccionado</div>
          )}
          </div>}

          {/* Layers tab */}
          {rightTab === 'layers' && (
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
              <LayersPanel
                layers={layers}
                version={layersVersion}
                mockupObjects={mockupObjects.current}
                garmentName={GARMENT_NAMES[project.mockupId] ?? 'Prenda'}
                selectedObj={selectedObj}
                onSelect={obj => {
                  const canvas = fc.current
                  if (!canvas) return
                  if ((obj as any)._locked || obj.visible === false) return
                  setTool('select')
                  setSelectedObj(obj)
                  canvas.isDrawingMode = false
                  canvas.selection = true
                  obj.selectable = true
                  obj.evented = true
                  canvas.setActiveObject(obj)
                  canvas.requestRenderAll()
                }}
                onToggleVisible={toggleLayerVisible}
                onToggleLock={toggleLayerLock}
                onMove={moveLayer}
                onReorder={reorderLayerTo}
                onDelete={deleteLayer}
                mockupLocked={mockupLocked}
                onToggleMockupLock={toggleMockupLock}
                onSelectMockup={selectMockupShape}
              />
            </div>
          )}

          {/* Textures tab */}
          {rightTab === 'textures' && (
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 14px' }}>
              <div className="label" style={{ marginBottom: 6 }}>Tela y color</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                Se aplica a <strong style={{ color: 'var(--accent)' }}>{selKind === 'none' ? 'toda la prenda' : 'lo seleccionado'}</strong>.
              </div>
              {mockupObjects.current.length > 0 && (
                <button onClick={togglePiecePaint} className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 14, fontSize: 11,
                    border: '1px solid ' + (mockupLocked ? 'var(--line)' : 'var(--accent)'),
                    color: mockupLocked ? 'var(--fg-2)' : 'var(--accent)' }}>
                  {mockupLocked ? '🖌  Pintar una pieza puntual' : '✓  Terminar (volver a toda la prenda)'}
                </button>
              )}

              {/* Color liso de la prenda (o de lo seleccionado) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <label style={{ position: 'relative', cursor: 'pointer' }}>
                  <input type="color" defaultValue="#ffffff"
                    onChange={e => applyGarmentSolid(e.target.value)}
                    style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                  <div style={{ width: 30, height: 30, borderRadius: 8,
                    background: 'conic-gradient(from 90deg, #f43f5e, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)',
                    border: '2px solid var(--line)' }} />
                </label>
                <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>Color liso</span>
              </div>

              <div className="label" style={{ marginBottom: 8 }}>Texturas de tela</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {TEXTURES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyTexture(t.id)}
                    title={`Aplicar ${t.label}`}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 6, padding: 0,
                      background: 'none', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      width: '100%', aspectRatio: '1', borderRadius: 8,
                      backgroundImage: `url(${makeTextureCanvas(t.id, texColors[t.id]).toDataURL()})`,
                      backgroundSize: '56px 56px',
                      border: '1px solid ' + (activeTexKind === t.id ? 'var(--accent)' : 'var(--line)'),
                      outline: activeTexKind === t.id ? '1px solid var(--accent)' : 'none',
                    }} />
                    <span style={{ fontSize: 11, color: 'var(--fg-2)', fontFamily: 'var(--ui)', textAlign: 'center' }}>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Editor de colores de la textura aplicada */}
              {activeTexKind && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
                  <div className="label" style={{ marginBottom: 10 }}>
                    Color · {TEXTURES.find(t => t.id === activeTexKind)?.label}
                  </div>

                  {/* Color principal (los demás se ajustan solos) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <label style={{ position: 'relative', cursor: 'pointer' }}>
                      <input type="color" value={texColors[activeTexKind][TEX_PRIMARY[activeTexKind]]}
                        onChange={e => setTexPrimary(activeTexKind, e.target.value)}
                        style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: texColors[activeTexKind][TEX_PRIMARY[activeTexKind]], border: '2px solid var(--line)' }} />
                    </label>
                    <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>Color principal</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{texColors[activeTexKind][TEX_PRIMARY[activeTexKind]]}</span>
                  </div>

                  {/* Opciones avanzadas: editar cada color por separado */}
                  {TEXTURE_COLORS[activeTexKind].length > 1 && (
                    <>
                      <button onClick={() => setTexAdvanced(v => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none',
                          color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: '6px 0', fontFamily: 'var(--ui)' }}>
                        <span style={{ display: 'inline-block', transform: texAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
                        Opciones avanzadas
                      </button>
                      {texAdvanced && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4, marginTop: 2 }}>
                          {TEXTURE_COLORS[activeTexKind].map((slot, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label style={{ position: 'relative', cursor: 'pointer' }}>
                                <input type="color" value={texColors[activeTexKind][i]}
                                  onChange={e => updateTexColor(activeTexKind, i, e.target.value)}
                                  style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                                <div style={{ width: 26, height: 26, borderRadius: 6, background: texColors[activeTexKind][i], border: '2px solid var(--line)' }} />
                              </label>
                              <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>{slot.label}</span>
                              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{texColors[activeTexKind][i]}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <button onClick={() => resetTexColors(activeTexKind)}
                    className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 11 }}>
                    Restablecer colores
                  </button>
                </div>
              )}

              {activeTexKind && (
                <button
                  onClick={() => applyGarmentSolid('#ffffff')}
                  className="btn btn-ghost"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12, fontSize: 12 }}
                >
                  Quitar textura (volver a color liso)
                </button>
              )}
            </div>
          )}
        </aside>
      {/* Hidden font file input */}
      <input
        ref={fontFileRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        style={{ display: 'none' }}
        onChange={handleFontUpload}
      />

      {/* Menú contextual (click derecho) */}
      {ctxMenu && (() => {
        const pieces = mockupObjects.current
        const named = pieces.filter(p => !/^Pieza/.test(pieceNameOf(p, 'Pieza')))
        const pieceList = named.length ? named : pieces
        const grouped = !!garmentGroupObj()
        const t = ctxMenu.target
        return (
          <>
            <div onClick={closeCtx} onContextMenu={e => { e.preventDefault(); closeCtx() }}
              style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
            <div style={{
              position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 210), top: ctxMenu.y, zIndex: 301,
              minWidth: 196, maxHeight: '80vh', overflowY: 'auto',
              background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
              padding: 5, boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--ui)', fontSize: 12.5,
            }}>
              {ctxMenu.isMulti && <CtxItem label="Agrupar selección" hint="Ctrl+G" onClick={() => { groupSelection(); closeCtx() }} />}
              {ctxMenu.isGroup && <CtxItem label="Desagrupar" hint="Ctrl+Shift+G" onClick={() => { if (t) ungroupTarget(t as fabric.Group); closeCtx() }} />}
              {!grouped && pieces.length > 1 && <CtxItem label="Agrupar prenda" onClick={() => { groupGarment(); closeCtx() }} />}
              {grouped && !ctxMenu.isGroup && <CtxItem label="Desagrupar prenda" onClick={() => { const g = garmentGroupObj(); if (g) ungroupTarget(g); closeCtx() }} />}

              {pieceList.length > 0 && (
                <>
                  <CtxDivider />
                  <div style={{ padding: '4px 10px 5px', color: 'var(--muted)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Seleccionar pieza</div>
                  {pieceList.map((p, i) => (
                    <CtxItem key={i} icon={getLayerIcon(p)} label={pieceNameOf(p, `Pieza ${i + 1}`)}
                      onClick={() => { selectPieceFromMenu(p); closeCtx() }} />
                  ))}
                </>
              )}

              {t && !ctxMenu.isMulti && !mockupObjects.current.includes(t) && !((t as any)._garmentGroup) && (
                <>
                  <CtxDivider />
                  <CtxItem label="Eliminar" danger onClick={() => { const c = fc.current; if (c && t) { c.remove(t); undoHistory.current.push({ type: 'remove', obj: t }); redoHistory.current = []; c.discardActiveObject(); c.requestRenderAll(); refreshLayersNow() } closeCtx() }} />
                </>
              )}
            </div>
          </>
        )
      })()}
    </div>
  )
}

// Ítem y separador del menú contextual
function CtxItem({ label, hint, icon, danger, onClick }: { label: string; hint?: string; icon?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
        background: 'transparent', color: danger ? 'var(--danger, #f87171)' : 'var(--fg-2)',
        fontFamily: 'var(--ui)', fontSize: 12.5,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 14%, var(--surface))'; e.currentTarget.style.color = danger ? 'var(--danger, #f87171)' : 'var(--fg)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = danger ? 'var(--danger, #f87171)' : 'var(--fg-2)' }}>
      {icon && <span style={{ width: 12, textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{hint}</span>}
    </button>
  )
}
function CtxDivider() {
  return <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 6px' }} />
}

// ── Layers panel ─────────────────────────────────────────────────────────────

// ── Texturas de tela ─────────────────────────────────────────────────────────
type TextureKind = 'rayas' | 'cuadrille' | 'lunares' | 'denim' | 'camuflado' | 'animal'

const TEXTURES: { id: TextureKind; label: string }[] = [
  { id: 'rayas',     label: 'Rayas' },
  { id: 'cuadrille', label: 'Cuadrillé' },
  { id: 'lunares',   label: 'Lunares' },
  { id: 'denim',     label: 'Denim' },
  { id: 'camuflado', label: 'Camuflado' },
  { id: 'animal',    label: 'Animal print' },
]

// Slots de color editables por textura (color principal = primero, secundario = segundo, etc.)
const TEXTURE_COLORS: Record<TextureKind, { label: string; def: string }[]> = {
  rayas:     [{ label: 'Fondo', def: '#f4f1e8' }, { label: 'Rayas', def: '#2b3a67' }],
  cuadrille: [{ label: 'Fondo', def: '#ffffff' }, { label: 'Cuadros', def: '#c41e3a' }],
  lunares:   [{ label: 'Fondo', def: '#e8c5d0' }, { label: 'Lunares', def: '#7a2a45' }],
  denim:     [{ label: 'Base', def: '#3b5b8c' }],
  camuflado: [{ label: 'Color 1', def: '#4b5320' }, { label: 'Color 2', def: '#6b6b3a' }, { label: 'Color 3', def: '#3a3f24' }, { label: 'Color 4', def: '#8a8559' }],
  animal:    [{ label: 'Fondo', def: '#d9a441' }, { label: 'Manchas', def: '#3a2410' }],
}
const defaultTexPalette = (k: TextureKind) => TEXTURE_COLORS[k].map(c => c.def)
// Convierte #rrggbb + alpha → rgba() (para el efecto translúcido del cuadrillé)
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// ── Color principal: ajusta el resto de la paleta automáticamente (manipulación HSL) ──
function hexToHsl(hex: string): [number, number, number] {
  const h0 = hex.replace('#', '')
  const r = parseInt(h0.slice(0, 2), 16) / 255, g = parseInt(h0.slice(2, 4), 16) / 255, b = parseInt(h0.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
function hslToHex(h: number, s: number, l: number): string {
  let r: number, g: number, b: number
  if (s === 0) { r = g = b = l } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3)
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const withL = (hex: string, l: number, sMul = 1) => { const [h, s] = hexToHsl(hex); return hslToHex(h, clamp01(s * sMul), clamp01(l)) }
const adjL   = (hex: string, d: number)          => { const [h, s, l] = hexToHsl(hex); return hslToHex(h, s, clamp01(l + d)) }

// Índice del slot que actúa como "color principal" en cada textura
const TEX_PRIMARY: Record<TextureKind, number> = { rayas: 1, cuadrille: 1, lunares: 1, denim: 0, camuflado: 0, animal: 0 }
// Dada la elección de color principal, deriva toda la paleta de la textura
function deriveTexPalette(kind: TextureKind, p: string): string[] {
  switch (kind) {
    case 'rayas':     return [withL(p, 0.92, 0.5), p]
    case 'cuadrille': return [withL(p, 0.97, 0.35), p]
    case 'lunares':   return [withL(p, 0.85, 0.6), p]
    case 'denim':     return [p]
    case 'camuflado': return [p, adjL(p, 0.10), adjL(p, -0.13), adjL(p, -0.26)]
    case 'animal':    return [p, adjL(p, -0.45)]
  }
}

// Dibuja un tile repetible de la textura sobre un canvas y lo devuelve
function makeTextureCanvas(kind: TextureKind, colors?: string[]): HTMLCanvasElement {
  const col = colors ?? defaultTexPalette(kind)
  const s = 56
  const c = document.createElement('canvas'); c.width = s; c.height = s
  const x = c.getContext('2d')!
  const rnd = (seed: number) => { const v = Math.sin(seed * 99.13) * 43758.5453; return v - Math.floor(v) }

  if (kind === 'rayas') {
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    x.fillStyle = col[1]
    for (let i = -s; i < s; i += 16) { x.fillRect(i, 0, 8, s) }
  } else if (kind === 'cuadrille') {
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    x.fillStyle = hexA(col[1], 0.55)
    x.fillRect(0, 0, s / 2, s); x.fillRect(0, 0, s, s / 2)
    x.fillStyle = hexA(col[1], 0.55)
    x.fillRect(0, 0, s / 2, s / 2); x.fillRect(s / 2, s / 2, s / 2, s / 2)
  } else if (kind === 'lunares') {
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    x.fillStyle = col[1]
    const dot = (cx: number, cy: number) => { x.beginPath(); x.arc(cx, cy, 5, 0, Math.PI * 2); x.fill() }
    dot(s * 0.25, s * 0.25); dot(s * 0.75, s * 0.75); dot(s * 0.75, s * 0.25); dot(s * 0.25, s * 0.75); dot(s * 0.5, s * 0.5)
  } else if (kind === 'denim') {
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    for (let i = 0; i < 1400; i++) {
      const px = rnd(i) * s, py = rnd(i + 7) * s, b = rnd(i + 3)
      x.fillStyle = b > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,60,0.18)'
      x.fillRect(px, py, 1, 1)
    }
    x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1
    for (let i = -s; i < s; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s, s); x.stroke() }
  } else if (kind === 'camuflado') {
    const cols = [col[0], col[1], col[2], col[3]]
    x.fillStyle = cols[0]; x.fillRect(0, 0, s, s)
    for (let i = 0; i < 22; i++) {
      x.fillStyle = cols[Math.floor(rnd(i) * cols.length)]
      const cx = rnd(i + 1) * s, cy = rnd(i + 2) * s, r = 6 + rnd(i + 3) * 10
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill()
    }
  } else { // animal (leopardo)
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    const spot = (cx: number, cy: number) => {
      x.strokeStyle = col[1]; x.lineWidth = 2.5
      for (let a = 0; a < 3; a++) {
        x.beginPath()
        x.arc(cx + (a - 1) * 5, cy + (a - 1) * 3, 4 + a, a, a + 2.4); x.stroke()
      }
    }
    spot(s * 0.25, s * 0.3); spot(s * 0.7, s * 0.6); spot(s * 0.5, s * 0.85); spot(s * 0.85, s * 0.2)
  }
  return c
}

// ── Remera paramétrica: deforma el SVG REAL del usuario moviendo sus puntos ───
type Measures = {
  largoTotal: number; anchoPecho: number; anchoCintura: number
  anchoCuello: number; profundidadCuello: number; largoManga: number; anchoManga: number
}
// Calibradas a una escala unica de 5.086 px/cm (largoTotal 70 = altura total del dibujo),
// asi todas las medidas son consistentes entre si (la manga no puede quedar mas larga que el cuerpo).
const DEFAULT_MEASURES: Measures = {
  largoTotal: 70, anchoPecho: 60, anchoCintura: 63,
  anchoCuello: 18, profundidadCuello: 8, largoManga: 18, anchoManga: 25,
}
const PARAMETRIC_TEE = true
const MEASURE_FIELDS: { key: keyof Measures; label: string; min: number; max: number }[] = [
  { key: 'largoTotal',        label: 'Largo total',          min: 55, max: 95 },
  { key: 'anchoPecho',        label: 'Ancho de pecho',       min: 46, max: 80 },
  { key: 'anchoCintura',      label: 'Ancho de cintura',     min: 46, max: 82 },
  { key: 'anchoCuello',       label: 'Ancho de cuello',      min: 13, max: 26 },
  { key: 'profundidadCuello', label: 'Profundidad de cuello',min: 4,  max: 16 },
  { key: 'largoManga',        label: 'Largo de manga',       min: 12, max: 50 },
  { key: 'anchoManga',        label: 'Ancho de manga',       min: 16, max: 38 },
]
// Grupos para el panel: colapsado se edita en general (todo junto), desplegado uno por uno.
const MEASURE_GROUPS: { id: string; label: string; keys: (keyof Measures)[] }[] = [
  { id: 'largo',  label: 'Largo',                keys: ['largoTotal'] },
  { id: 'ancho',  label: 'Ancho (pecho/cintura)', keys: ['anchoPecho', 'anchoCintura'] },
  { id: 'cuello', label: 'Cuello',               keys: ['anchoCuello', 'profundidadCuello'] },
  { id: 'manga',  label: 'Manga',                keys: ['largoManga', 'anchoManga'] },
]

// Tiradores de medida: punto base en el SVG + cómo convertir su posición a cm.
const TEE_HANDLES: { key: keyof Measures; base: [number, number]; axis: 'x' | 'y'; toMeasure: (sx: number, sy: number, m: Measures) => number }[] = [
  // El handle de pecho va sobre el TORSO (x<395), no en la axila, para no solaparse con
  // los de la manga ni montarse sobre ella al alargarla. Mide el ancho con la escala fP del cuerpo.
  { key: 'anchoPecho',   base: [380, 150],       axis: 'x', toMeasure: (sx) => (sx - 247.3) / 132.7 * 60 },
  { key: 'anchoCintura', base: [408.98, 357],    axis: 'x', toMeasure: (sx) => (sx - 247.3) / 161.68 * 63 },
  { key: 'largoTotal',   base: [247.3, 357],     axis: 'y', toMeasure: (_sx, sy) => 33.8 + (sy - 173) / 5.086 },
  { key: 'anchoCuello',  base: [292.24, 4.64],   axis: 'x', toMeasure: (sx) => (sx - 247.3) / 44.94 * 18 },
  { key: 'largoManga',   base: [493.43, 58.94],  axis: 'x', toMeasure: (sx, _sy, m) => { const nUR = 247.3 + 153.65 * (m.anchoPecho / 60); return (sx - nUR) / 92.48 * 18 } },
  { key: 'anchoManga',   base: [470.28, 177.99], axis: 'y', toMeasure: (_sx, sy) => (sy - 50) / 127.99 * 25 },
]

// Paths del SVG real (tshirt.svg). El cuerpo es la pieza con relleno (define el recorte).
const TEE_BODY = "M292.24,4.64l201.19,54.3-23.15,119.05-69.33-4.77,8.03,184.05-328.13-1.07,11.64-183.05-69.91,4.91L1.14,50.05,205.89,1.08s22.26,16.91,86.35,3.56Z"
const TEE_DETAILS = [
  "M208.82,15.39s38.5,12.6,80.07,2.15",
  "M194.91,3.44s8.06,61.75,52.53,61.75,49.54-52.07,52.99-58.06",
  "M101.36,26.21s24.92,50.85-8.87,146.95",
  "M392.43,31.46s-25.26,45.67,8.53,141.78",
  "M462.27,174.84L485.7,56.86",
  "M207.82,10.09s39.45,12.6,82.06,2.15",
  "M205.89,1.08s7.91,55.81,41.09,55.81,42.6-42.75,45.26-52.25",
  "M30.48,176.77L8.82,49.98",
  "M86.04,343.69L407.63,343.69",
]

// Transforma un path SVG aplicando W a cada coordenada (convierte todo a absoluto).
function transformPath(d: string, W: (x: number, y: number) => [number, number]): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g)
  if (!toks) return d
  let i = 0, cur: [number, number] = [0, 0], start: [number, number] = [0, 0], cmd = '', pc: [number, number] | null = null
  const out: string[] = []
  const num = () => parseFloat(toks[i++])
  const isCmd = (t: string) => /[a-zA-Z]/.test(t)
  const e = (p: [number, number]) => { const q = W(p[0], p[1]); return `${q[0].toFixed(2)} ${q[1].toFixed(2)}` }
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++]
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    if (C === 'M') {
      let x = num(), y = num(); if (rel) { x += cur[0]; y += cur[1] } cur = [x, y]; start = [x, y]; out.push('M ' + e(cur)); pc = null
      while (i < toks.length && !isCmd(toks[i])) { let x2 = num(), y2 = num(); if (rel) { x2 += cur[0]; y2 += cur[1] } cur = [x2, y2]; out.push('L ' + e(cur)) }
    } else if (C === 'L') { let x = num(), y = num(); if (rel) { x += cur[0]; y += cur[1] } cur = [x, y]; out.push('L ' + e(cur)); pc = null }
    else if (C === 'H') { let x = num(); if (rel) x += cur[0]; cur = [x, cur[1]]; out.push('L ' + e(cur)); pc = null }
    else if (C === 'V') { let y = num(); if (rel) y += cur[1]; cur = [cur[0], y]; out.push('L ' + e(cur)); pc = null }
    else if (C === 'C') { while (i < toks.length && !isCmd(toks[i])) { let c1: [number, number] = [num(), num()], c2: [number, number] = [num(), num()], en: [number, number] = [num(), num()]; if (rel) { c1 = [c1[0] + cur[0], c1[1] + cur[1]]; c2 = [c2[0] + cur[0], c2[1] + cur[1]]; en = [en[0] + cur[0], en[1] + cur[1]] } out.push('C ' + e(c1) + ' ' + e(c2) + ' ' + e(en)); pc = c2; cur = en } }
    else if (C === 'S') { while (i < toks.length && !isCmd(toks[i])) { let c2: [number, number] = [num(), num()], en: [number, number] = [num(), num()]; if (rel) { c2 = [c2[0] + cur[0], c2[1] + cur[1]]; en = [en[0] + cur[0], en[1] + cur[1]] } const c1: [number, number] = pc ? [2 * cur[0] - pc[0], 2 * cur[1] - pc[1]] : [cur[0], cur[1]]; out.push('C ' + e(c1) + ' ' + e(c2) + ' ' + e(en)); pc = c2; cur = en } }
    else if (C === 'Q') { while (i < toks.length && !isCmd(toks[i])) { let c: [number, number] = [num(), num()], en: [number, number] = [num(), num()]; if (rel) { c = [c[0] + cur[0], c[1] + cur[1]]; en = [en[0] + cur[0], en[1] + cur[1]] } out.push('Q ' + e(c) + ' ' + e(en)); pc = c; cur = en } }
    else if (C === 'Z') { out.push('Z'); cur = [start[0], start[1]]; pc = null }
    else { i++ }
  }
  return out.join(' ')
}

// W: mueve cada punto del SVG según las medidas (con medidas por defecto = identidad).
function teeWarp(m: Measures): (x: number, y: number) => [number, number] {
  const cx = 247.3, armY = 173, hemY = 357, slvTop = 50, URx = 400.95, ULx = 92.49
  // fLen modela el LARGO TOTAL real (HPS al ruedo): 33.8cm fijos del torso superior + la parte
  // inferior (36.2cm por defecto) que es la que se estira. fLen = 1 con largoTotal = 70.
  const fLen = (m.largoTotal - 33.8) / 36.2, fP = m.anchoPecho / 60, fC = m.anchoCintura / 63, fN = m.anchoCuello / 18
  const fML = m.largoManga / 18, fMA = m.anchoManga / 25, dProf = (m.profundidadCuello - 8) * 5.0
  return (x, y) => {
    const rSlv = x > 395 && y < 200, lSlv = x < 100 && y < 200
    // Manga: largo = extender en X desde la axila; ancho = ensanchar hacia ABAJO (anclado arriba).
    // Al alargarse, la manga ROTA alrededor de la punta del hombro: el HOMBRO se mantiene igual y
    // la manga cae en angulo (el puño no se acampana). El angulo crece con cuanto se estiro
    // (fML-1), con tope para que no se pliegue sobre si misma.
    if (rSlv || lSlv) {
      const URo = rSlv ? URx : ULx, sign = rSlv ? 1 : -1
      const nUR = cx + (URo - cx) * fP
      let ox = nUR + (x - URo) * fML
      let oy = slvTop + (y - slvTop) * fMA
      const srcPx = rSlv ? 493.43 : (2 * cx - 493.43)        // punta del hombro (espejada para la izq)
      const pX = nUR + (srcPx - URo) * fML, pY = slvTop + (58.94 - slvTop) * fMA
      const th = Math.min(0.46, Math.max(0, fML - 1) * 0.22) * sign
      const dx = ox - pX, dy = oy - pY
      ox = pX + dx * Math.cos(th) - dy * Math.sin(th)
      oy = pY + dx * Math.sin(th) + dy * Math.cos(th)
      return [ox, oy]
    }
    if (y < 70 && Math.abs(x - cx) < 70) { const w = Math.max(0, Math.min(1, (y - 1) / 64)); return [cx + (x - cx) * fN, y + dProf * w] }
    const wf = y <= armY ? fP : y >= hemY ? fC : fP + (fC - fP) * ((y - armY) / (hemY - armY))
    return [cx + (x - cx) * wf, y <= armY ? y : armY + (y - armY) * fLen]
  }
}

// Devuelve las figuras de la remera en coordenadas cm (origen x=0 en el centro).
// La manga se ancla al hombro y a la axila: así el ancho de pecho mueve el costado
// y empuja la manga hacia afuera, como una remera real.
function buildTeeShapes(m: Measures): { d: string; role: 'piece' | 'detail'; fill: string | null; stroke: string; strokeWidth: number }[] {
  const W = teeWarp(m)
  const shapes: { d: string; role: 'piece' | 'detail'; fill: string | null; stroke: string; strokeWidth: number }[] = [
    { d: transformPath(TEE_BODY, W), role: 'piece', fill: '#b2b2b2', stroke: '#010101', strokeWidth: 2 },
  ]
  for (const d of TEE_DETAILS) shapes.push({ d: transformPath(d, W), role: 'detail', fill: null, stroke: '#1d1d1b', strokeWidth: 2 })
  return shapes
}

// Quita el fondo de una imagen: flood-fill desde los bordes eliminando los píxeles
// parecidos al color de fondo (muestreado en las esquinas). Solo borra regiones de fondo
// conectadas al borde, así no se come colores iguales que estén dentro del sujeto.
function removeBgFromImageData(data: ImageData, tolerance = 42): void {
  const w = data.width, h = data.height, px = data.data
  const cornerIdx = [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)]
  let br = 0, bg = 0, bb = 0
  for (const c of cornerIdx) { br += px[c * 4]; bg += px[c * 4 + 1]; bb += px[c * 4 + 2] }
  br /= 4; bg /= 4; bb /= 4
  const tol2 = tolerance * tolerance * 3
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  for (let xx = 0; xx < w; xx++) { stack.push(xx, (h - 1) * w + xx) }
  for (let yy = 0; yy < h; yy++) { stack.push(yy * w, yy * w + w - 1) }
  const matches = (i: number) => {
    const dr = px[i * 4] - br, dg = px[i * 4 + 1] - bg, db = px[i * 4 + 2] - bb
    return dr * dr + dg * dg + db * db <= tol2
  }
  while (stack.length) {
    const i = stack.pop()!
    if (visited[i]) continue
    visited[i] = 1
    if (!matches(i)) continue
    px[i * 4 + 3] = 0
    const x = i % w, y = (i / w) | 0
    if (x > 0) stack.push(i - 1)
    if (x < w - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - w)
    if (y < h - 1) stack.push(i + w)
  }
}

function getLayerLabel(obj: fabric.FabricObject): string {
  if ((obj as any)._pieceName) return (obj as any)._pieceName as string
  if ((obj as any)._garmentGroup) return 'Prenda'
  const t = (obj as any).type as string
  if (t === 'i-text' || t === 'text') return (obj as any).text?.slice(0, 20) || 'Texto'
  if (t === 'path')   return 'Trazado'
  if (t === 'line')   return 'Línea'
  if (t === 'rect')   return 'Rectángulo'
  if (t === 'circle') return 'Círculo'
  if (t === 'group')  return 'Grupo'
  return t ?? 'Objeto'
}

function getLayerIcon(obj: fabric.FabricObject): string {
  const t = (obj as any).type as string
  if (t === 'i-text' || t === 'text') return 'T'
  if (t === 'path')   return '∿'
  if (t === 'line')   return '╱'
  if (t === 'rect')   return '▭'
  if (t === 'circle') return '○'
  if (t === 'group')  return '⬡'
  return '·'
}

function LayersPanel({ layers, version, mockupObjects, garmentName, selectedObj, onSelect, onToggleVisible, onToggleLock, onMove, onReorder, onDelete, mockupLocked, onToggleMockupLock, onSelectMockup }: {
  layers: fabric.FabricObject[]
  version: number
  mockupObjects: fabric.FabricObject[]
  garmentName: string
  selectedObj: fabric.FabricObject | null
  onSelect: (obj: fabric.FabricObject) => void
  onToggleVisible: (obj: fabric.FabricObject) => void
  onToggleLock: (obj: fabric.FabricObject) => void
  onMove: (obj: fabric.FabricObject, dir: 'up' | 'down') => void
  onReorder: (from: fabric.FabricObject, to: fabric.FabricObject) => void
  onDelete: (obj: fabric.FabricObject) => void
  mockupLocked: boolean
  onToggleMockupLock: () => void
  onSelectMockup: (obj: fabric.FabricObject) => void
}) {
  void version  // forces re-render when visibility/lock toggles mutate objects in place
  const [mockupOpen, setMockupOpen] = useState(false)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // User objects in stacking order, front-most first (top of the list = top of the canvas)
  const userObjs = layers.filter(o => !mockupObjects.includes(o))
  const ordered  = [...userObjs].reverse()
  const hasMockup = mockupObjects.length > 0

  if (ordered.length === 0 && !hasMockup) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        Sin capas todavía. Dibujá algo para empezar.
      </div>
    )
  }

  const iconBtn = (content: React.ReactNode, title: string, onClick: () => void, active = false, danger = false): React.ReactNode => (
    <span
      role="button"
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: 5,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, cursor: 'pointer', userSelect: 'none',
        color: danger ? 'var(--muted)' : (active ? 'var(--accent)' : 'var(--muted)'),
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = danger ? 'var(--red, #f87171)' : 'var(--fg)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = danger ? 'var(--muted)' : (active ? 'var(--accent)' : 'var(--muted)') }}
    >
      {content}
    </span>
  )

  return (
    <div>
      {ordered.map((obj, i) => {
        const isSelected = obj === selectedObj
        const locked  = !!(obj as any)._locked
        const hidden  = obj.visible === false
        const isFirst = i === 0                       // front-most → can't go further up
        const isLast  = i === ordered.length - 1      // back-most → can't go further down
        return (
          <div
            key={i}
            draggable
            onDragStart={e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={e => { e.preventDefault(); if (dragOver !== i) setDragOver(i) }}
            onDragLeave={() => setDragOver(d => d === i ? null : d)}
            onDrop={e => {
              e.preventDefault(); setDragOver(null)
              const from = Number(e.dataTransfer.getData('text/plain'))
              if (!Number.isNaN(from) && ordered[from] && ordered[from] !== obj) onReorder(ordered[from], obj)
            }}
            onClick={() => onSelect(obj)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 8px 5px 10px',
              background: isSelected ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
              borderLeft: '2px solid ' + (isSelected ? 'var(--accent)' : 'transparent'),
              borderTop: dragOver === i ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'grab', fontFamily: 'var(--ui)', fontSize: 11,
              color: hidden ? 'var(--muted)' : (isSelected ? 'var(--fg)' : 'var(--fg-2)'),
              borderBottom: '1px solid var(--line-soft)',
              opacity: hidden ? 0.55 : 1,
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface)' }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 10, color: isSelected ? 'var(--accent)' : 'var(--muted)', width: 12, textAlign: 'center', flexShrink: 0 }}>{getLayerIcon(obj)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: locked ? 'none' : 'none' }}>
              {getLayerLabel(obj)}
            </span>

            {/* Reorder */}
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 0.7, flexShrink: 0 }}>
              <span role="button" title="Subir" onClick={e => { e.stopPropagation(); if (!isFirst) onMove(obj, 'up') }}
                style={{ fontSize: 9, cursor: isFirst ? 'default' : 'pointer', color: isFirst ? 'var(--line)' : 'var(--muted)', padding: '0 2px' }}>▲</span>
              <span role="button" title="Bajar" onClick={e => { e.stopPropagation(); if (!isLast) onMove(obj, 'down') }}
                style={{ fontSize: 9, cursor: isLast ? 'default' : 'pointer', color: isLast ? 'var(--line)' : 'var(--muted)', padding: '0 2px' }}>▼</span>
            </span>

            {iconBtn(hidden ? '🚫' : '👁', hidden ? 'Mostrar' : 'Ocultar', () => onToggleVisible(obj), !hidden)}
            {iconBtn(locked ? '🔒' : '🔓', locked ? 'Desbloquear' : 'Bloquear', () => onToggleLock(obj), locked)}
            {iconBtn('✕', 'Eliminar', () => onDelete(obj), false, true)}
          </div>
        )
      })}

      {hasMockup && (
        <div style={{ marginTop: 4, borderTop: '1px solid var(--line-soft)' }}>
          {/* Encabezado del grupo Mockup */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 8px 7px 10px',
            color: 'var(--fg-2)', fontFamily: 'var(--ui)', fontSize: 11,
          }}>
            <span role="button" onClick={() => setMockupOpen(v => !v)}
              style={{ fontSize: 9, cursor: 'pointer', transition: 'transform 0.15s', transform: mockupOpen ? 'none' : 'rotate(-90deg)', width: 10 }}>▾</span>
            <span style={{ fontSize: 11, width: 12, textAlign: 'center' }}>⬡</span>
            <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setMockupOpen(v => !v)}>Prenda · {garmentName}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', marginRight: 2 }}>{mockupObjects.length}</span>
            <span
              role="button"
              title={mockupLocked ? 'Desbloquear mockup' : 'Bloquear mockup'}
              onClick={onToggleMockupLock}
              style={{
                width: 20, height: 20, borderRadius: 5, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: mockupLocked ? 'var(--accent)' : 'var(--muted)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{mockupLocked ? '🔒' : '🔓'}</span>
          </div>

          {/* Sub-capas del mockup */}
          {mockupOpen && mockupObjects.map((obj, i) => {
            const isSelected = obj === selectedObj
            return (
              <div
                key={i}
                onClick={() => onSelectMockup(obj)}
                title={mockupLocked ? 'Desbloqueá el mockup para editar' : 'Seleccionar pieza'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 10px 5px 30px',
                  background: isSelected ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
                  borderLeft: '2px solid ' + (isSelected ? 'var(--accent)' : 'transparent'),
                  cursor: mockupLocked ? 'default' : 'pointer',
                  fontFamily: 'var(--ui)', fontSize: 11,
                  color: mockupLocked ? 'var(--muted)' : 'var(--fg-2)',
                }}
                onMouseEnter={e => { if (!mockupLocked && !isSelected) e.currentTarget.style.background = 'var(--surface)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 10, color: 'var(--muted)', width: 12, textAlign: 'center' }}>{getLayerIcon(obj)}</span>
                <span>{pieceNameOf(obj, `Pieza ${mockupObjects.length - i}`)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ToolBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} title={label} style={{
      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
      border: '1.5px solid ' + (active ? 'var(--accent)' : 'transparent'),
      color: active ? 'var(--accent)' : 'var(--fg-2)',
      cursor: 'pointer', fontSize: 16,
      transition: 'all 0.15s var(--ease)',
    }}>
      {icon}
    </button>
  )
}


const IconEraser = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="6" width="14" height="7" rx="2" />
    <rect x="1" y="6" width="6" height="7" rx="2" opacity="0.45" />
    <rect x="1" y="10.5" width="14" height="2.5" rx="0" opacity="0.15" />
  </svg>
)

const IconBucket = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M5 4.5 Q8 1.5 11 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M3.5 5.5 L5 14 L11 14 L12.5 5.5 Z" />
    <rect x="3.5" y="5" width="9" height="1.5" rx="0.5" />
  </svg>
)

const IconEyedropper = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.5 1.5 L14.5 4.5 L7 12 L5 14 L2 11 L4 9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M11.5 1.5 L14.5 4.5 L12.5 6.5 L9.5 3.5 Z" />
    <rect x="3" y="11" width="3" height="3" rx="0.8" opacity="0.6" />
  </svg>
)

const ToolDivider = () => (
  <div style={{ height: 1, width: 24, background: 'var(--line-soft)', margin: '3px 0', flexShrink: 0 }} />
)

// Miniaturas para el selector de estilo de trazado (Normal / Bordado / Cierre)
function StrokeStyleIcon({ kind }: { kind: StrokeStyle }) {
  if (kind === 'normal') return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 7 Q10 1 18 7" />
    </svg>
  )
  if (kind === 'bordado') return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <line x1="3" y1="9" x2="5" y2="4" /><line x1="5" y1="9.5" x2="7" y2="4.5" />
      <line x1="7" y1="9.5" x2="9" y2="4.5" /><line x1="9" y1="9.3" x2="11" y2="4.3" />
      <line x1="11" y1="9.5" x2="13" y2="4.5" /><line x1="13" y1="9" x2="15" y2="4" />
      <line x1="15" y1="8.5" x2="17" y2="4" />
    </svg>
  )
  // cierre
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <line x1="9" y1="2" x2="9" y2="12" /><line x1="11" y1="2" x2="11" y2="12" />
      <line x1="9" y1="3.5" x2="6.5" y2="3.5" /><line x1="11" y1="5.5" x2="13.5" y2="5.5" />
      <line x1="9" y1="7.5" x2="6.5" y2="7.5" /><line x1="11" y1="9.5" x2="13.5" y2="9.5" />
    </svg>
  )
}

function AlignBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
      color: 'var(--fg-2)', cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg-2)' }}
    >{children}</button>
  )
}
function AlignGlyph({ dir }: { dir: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom' | 'disth' | 'distv' }) {
  const c = 'currentColor'
  const guide = (x1: number, y1: number, x2: number, y2: number) =>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={1.2} />
  const bar = (x: number, y: number, w: number, h: number) =>
    <rect x={x} y={y} width={w} height={h} fill={c} rx={0.5} />
  let body: React.ReactNode = null
  if (dir === 'left')         body = <>{guide(2, 1.5, 2, 13.5)}{bar(3, 3.5, 9, 2.6)}{bar(3, 8.9, 6, 2.6)}</>
  else if (dir === 'hcenter') body = <>{guide(7.5, 1.5, 7.5, 13.5)}{bar(3, 3.5, 9, 2.6)}{bar(4.5, 8.9, 6, 2.6)}</>
  else if (dir === 'right')   body = <>{guide(13, 1.5, 13, 13.5)}{bar(3, 3.5, 9, 2.6)}{bar(6, 8.9, 6, 2.6)}</>
  else if (dir === 'top')     body = <>{guide(1.5, 2, 13.5, 2)}{bar(3.5, 3, 2.6, 9)}{bar(8.9, 3, 2.6, 6)}</>
  else if (dir === 'vmiddle') body = <>{guide(1.5, 7.5, 13.5, 7.5)}{bar(3.5, 3, 2.6, 9)}{bar(8.9, 4.5, 2.6, 6)}</>
  else if (dir === 'bottom')  body = <>{guide(1.5, 13, 13.5, 13)}{bar(3.5, 3, 2.6, 9)}{bar(8.9, 6, 2.6, 6)}</>
  else if (dir === 'disth')   body = <>{bar(2, 2.5, 2, 10)}{bar(6.5, 2.5, 2, 10)}{bar(11, 2.5, 2, 10)}</>
  else                        body = <>{bar(2.5, 2, 10, 2)}{bar(2.5, 6.5, 10, 2)}{bar(2.5, 11, 10, 2)}</>
  return <svg width="15" height="15" viewBox="0 0 15 15">{body}</svg>
}
function PathfinderGlyph({ op }: { op: 'unite' | 'subtract' | 'intersect' | 'exclude' }) {
  const c = 'currentColor', bg = 'var(--surface)'
  const r = (x: number, y: number, fill: string, stroke: string) =>
    <rect x={x} y={y} width={8} height={8} rx={1.3} fill={fill} stroke={stroke} strokeWidth={1.2} />
  let body: React.ReactNode = null
  if (op === 'unite')          body = <>{r(1.5, 1.5, c, 'none')}{r(5.5, 5.5, c, 'none')}</>
  else if (op === 'intersect') body = <>{r(1.5, 1.5, 'none', c)}{r(5.5, 5.5, 'none', c)}<rect x={5.5} y={5.5} width={4} height={4} fill={c} /></>
  else if (op === 'subtract')  body = <>{r(1.5, 1.5, c, 'none')}{r(5.5, 5.5, bg, c)}</>
  else                         body = <>{r(1.5, 1.5, c, 'none')}{r(5.5, 5.5, c, 'none')}<rect x={5.5} y={5.5} width={4} height={4} fill={bg} /></>
  return <svg width="15" height="15" viewBox="0 0 15 15">{body}</svg>
}
const IconSelect = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 1.5 L13 8 L8 8.5 L11 13 L9 14 L6 9.5 L3 12 Z" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
  </svg>
)
const IconPen = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
    <path d="M3 14 L5 9 L11 3 L13 5 L7 11 Z" fill="currentColor" fillOpacity="0.15" />
    <path d="M11 3 L13 5" />
    <path d="M5 9 L7 11" />
  </svg>
)
const IconCurve = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M2 12 Q8 -1 14 12" />
    <circle cx="2" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="14" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)
const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
    <path d="M2 14 L3.5 10 L10.5 3 L13 5.5 L6 12.5 Z" />
    <path d="M9.5 4 L12 6.5" />
  </svg>
)
const IconText = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 2 H13 V4.5 H11.4 V3.4 H8.9 V12.6 H10.3 V14 H5.7 V12.6 H7.1 V3.4 H4.6 V4.5 H3 Z" />
  </svg>
)
const IconRect = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2.5" y="4" width="11" height="8" rx="1" />
  </svg>
)
const IconEllipse = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <ellipse cx="8" cy="8" rx="6" ry="5" />
  </svg>
)
const IconLine = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="3" y1="13" x2="13" y2="3" />
  </svg>
)
const IconHand = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10" />
    <path d="M11 9.5V4.5a1.5 1.5 0 0 1 3 0V10" />
    <path d="M14 10V6a1.5 1.5 0 0 1 3 0v6" />
    <path d="M8 11V8.8a1.5 1.5 0 0 0-3 0v3.2c0 3.6 2.3 6 6 6s6-2.4 6-6V11.5" />
  </svg>
)
const IconZoom = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="4.3" />
    <line x1="10.2" y1="10.2" x2="14" y2="14" strokeWidth="1.7" />
    <line x1="7" y1="5.2" x2="7" y2="8.8" />
    <line x1="5.2" y1="7" x2="8.8" y2="7" />
  </svg>
)

function FontSection({ label, fonts, filter, selected, onSelect }: {
  label: string
  fonts: readonly string[]
  filter: string
  selected: string
  onSelect: (f: string) => void
}) {
  const visible = filter
    ? fonts.filter(f => f.toLowerCase().includes(filter.toLowerCase()))
    : fonts
  if (visible.length === 0) return null
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)' }}>
      <div style={{ padding: '6px 10px 2px', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {visible.map(f => (
        <FontRow key={f} name={f} selected={selected === f} onClick={() => onSelect(f)} />
      ))}
    </div>
  )
}

function FontRow({ name, selected, onClick }: { name: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '6px 10px', border: 'none', textAlign: 'left',
        background: selected ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
        color: selected ? 'var(--accent)' : 'var(--fg)',
        fontFamily: name, fontSize: 14, cursor: 'pointer',
        transition: 'background 0.1s', flex: 1,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {name}
    </button>
  )
}
