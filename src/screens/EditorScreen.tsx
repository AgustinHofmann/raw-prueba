import { useEffect, useRef, useState, type RefObject } from 'react'
import * as fabric from 'fabric'
import { Project } from '../types/project'
import './EditorScreen.css'

interface Props {
  project: Project
  onBack: () => void
  onSave: (thumbnail: string) => void
}

type Tool = 'select' | 'draw' | 'pencil' | 'pen' | 'curve' | 'eraser' | 'fill' | 'text'

type HistoryEntry =
  | { type: 'add';    obj: fabric.FabricObject }
  | { type: 'remove'; obj: fabric.FabricObject }
  | { type: 'fill';   obj: fabric.FabricObject; prevFill: fabric.TFiller | string | null }
  | { type: 'modify'; prev: fabric.FabricObject; next: fabric.FabricObject }

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
    })
  }
  if (hoverCur) (newObj as any).hoverCursor = hoverCur
  canvas.add(newObj)
  undoHistory.current.push({ type: 'modify', prev: old, next: newObj })
  return newObj
}

// Reconstruye un path mezclando segmentos rectos (corners) y curvas suaves (Catmull-Rom).
// Para anclas suaves usa la fórmula Catmull-Rom estándar, garantizando continuidad C1.
// Para corners usa el propio punto como vecino ficticio, colapsando el handle al segmento.
// Esto es matemáticamente equivalente a catmullRomToBezier cuando todos son smooth.
function buildMixedPath(positions: fabric.Point[], smoothAnchors: Set<number>, closed = false): string {
  const n = positions.length
  if (n < 2) return ''

  let d = `M ${positions[0].x} ${positions[0].y}`
  // For closed paths iterate n segments (including the closing segment back to positions[0])
  const segments = closed ? n : n - 1
  for (let j = 0; j < segments; j++) {
    const j1  = (j + 1) % n
    const Pj  = positions[j]
    const Pj1 = positions[j1]
    const s0  = smoothAnchors.has(j)
    const s1  = smoothAnchors.has(j1)

    if (!s0 && !s1) { d += ` L ${Pj1.x} ${Pj1.y}`; continue }

    // Catmull-Rom neighbors — wrap around for closed paths, clamp for open.
    // Corner anchors use zero-length handles (cp = anchor point) so the curve
    // departs/arrives without a belly, matching Illustrator's corner behavior.
    let pPrev: { x: number; y: number }
    if (s0) {
      pPrev = j === 0
        ? (closed ? positions[n - 1] : positions[0])
        : positions[j - 1]
    } else {
      pPrev = Pj1  // makes cp1 = Pj (zero-length outgoing handle at corner)
    }

    let pNext: { x: number; y: number }
    if (s1) {
      pNext = j1 === n - 1
        ? (closed ? positions[0] : positions[n - 1])
        : positions[j1 + 1]
    } else {
      pNext = Pj  // makes cp2 = Pj1 (zero-length incoming handle at corner)
    }

    const cp1x = Pj.x  + (Pj1.x - pPrev.x) / 6
    const cp1y = Pj.y  + (Pj1.y - pPrev.y) / 6
    const cp2x = Pj1.x - (pNext.x - Pj.x)  / 6
    const cp2y = Pj1.y - (pNext.y - Pj.y)  / 6

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

// Lápiz: punta abajo-izquierda, borrador arriba-derecha
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect x='8' y='1' width='5' height='12' rx='1' fill='%23f5c842' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='8,13 13,13 10.5,18' fill='%23e8a87c' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='9.5,16.5 11.5,16.5 10.5,18' fill='%23222'/%3E%3Crect x='8' y='1' width='5' height='3' rx='1' fill='%23bbb' stroke='%23333' stroke-width='1'/%3E%3C/svg%3E") 10 18, crosshair`

const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Helvetica', 'Impact', 'Trebuchet MS', 'Palatino', 'Garamond']

export default function EditorScreen({ project, onBack, onSave }: Props) {
  const canvasEl      = useRef<HTMLCanvasElement>(null)
  const canvasAreaRef = useRef<HTMLElement>(null)
  const cursorRef     = useRef<HTMLDivElement>(null)
  const fc            = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const clipPath      = useRef<fabric.Group | null>(null)
  const undoHistory   = useRef<HistoryEntry[]>([])
  const redoHistory   = useRef<HistoryEntry[]>([])
  const clipboardBuf  = useRef<fabric.FabricObject | null>(null)
  const colorRef      = useRef('#ff6b00')
  const brushSizeRef  = useRef(8)
  const fontFamilyRef = useRef('Arial')
  const isMouseDown   = useRef(false)
  const snapPoints    = useRef<fabric.Point[]>([])

  const [tool, setTool]   = useState<Tool>('select')
  const [saved, setSaved] = useState(false)

  const [hasSel,        setHasSel]        = useState(false)
  const [isText,        setIsText]        = useState(false)
  const [propFill,      setPropFill]      = useState<string | null>(null)
  const [propStroke,    setPropStroke]    = useState('#ff6b00')
  const [propSWidth,    setPropSWidth]    = useState(8)
  const [propFontFamily, setPropFontFamily] = useState('Arial')
  const [propFontSize,  setPropFontSize]  = useState(24)

  useEffect(() => { colorRef.current      = propStroke    }, [propStroke])
  useEffect(() => { brushSizeRef.current  = propSWidth    }, [propSWidth])
  useEffect(() => { fontFamilyRef.current = propFontFamily }, [propFontFamily])

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
    })
    fc.current = canvas

    canvas.selectionColor       = 'rgba(29, 119, 224, 0.06)'
    canvas.selectionBorderColor = '#1D77E0'
    canvas.selectionLineWidth   = 1
    ;(canvas as any).selectionDashArray = [4, 3]
    ;(canvas as any).uniformScaling     = false
    canvas.skipOffscreen = false  // evita que Fabric oculte objetos al hacer zoom

    Object.assign(fabric.FabricObject.prototype, {
      borderColor:        '#1D77E0',
      borderScaleFactor:  1,
      cornerColor:        '#ffffff',
      cornerStrokeColor:  '#1D77E0',
      cornerSize:         7,
      cornerStyle:        'rect',
      transparentCorners: false,
      padding:            2,
    })

    try {
      fabric.FabricObject.prototype.controls.mtr.visible = false
    } catch (_) {}

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
      const pad = Math.min(CW, CH) * 0.1          // 10% de margen
      const sc  = Math.min((CW - pad * 2) / bw, (CH - pad * 2) / bh)
      const ox  = (CW - bw * sc) / 2 - bx * sc
      const oy  = (CH - bh * sc) / 2 - by * sc

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
        redoHistory.current = []
        canvas.renderAll()
      })

      canvas.renderAll()
    })

    return () => { cancelled = true; canvas.dispose() }
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
    }

    let midPan = false
    let midLast = { x: 0, y: 0 }

    const onMDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()  // evita que la herramienta activa procese el clic medio
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
    }

    const onMUp = (e: MouseEvent) => {
      if (e.button !== 1) return
      midPan = false
      area.style.cursor = ''
    }

    area  .addEventListener('wheel',     onWheel, { passive: false })
    area  .addEventListener('mousedown', onMDown,  { capture: true })
    window.addEventListener('mousemove', onMMove)
    window.addEventListener('mouseup',   onMUp)
    return () => {
      area  .removeEventListener('wheel',     onWheel)
      area  .removeEventListener('mousedown', onMDown, { capture: true })
      window.removeEventListener('mousemove', onMMove)
      window.removeEventListener('mouseup',   onMUp)
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
      obj.set({
        evented:    isMockup
          ? tool === 'fill'
          : (tool === 'select' || tool === 'curve' || tool === 'pen' || (tool === 'text' && isIText)),
        selectable: isMockup ? false : tool === 'select',
        ...(!isMockup ? { hoverCursor: drawnHoverCursor } : {}),
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

        // 2. Suavizar con Catmull-Rom → bezier
        const d = catmullRomToBezier(simplified)
        const obj = new fabric.Path(d, {
          stroke: colorRef.current,
          strokeWidth: brushSizeRef.current,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          fill: null,
          selectable: false, evented: false,
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

      const showAnchors = (obj: fabric.FabricObject) => {
        clearAnchorHandles(aHandles, canvas)
        editObj  = obj
        aHandles = buildAnchorHandles(obj, canvas)
      }

      const clearEdit = () => {
        clearAnchorHandles(aHandles, canvas)
        editObj = null
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
        if (closeIt) d += ' Z'
        return d
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
      const redraw = (cursor?: fabric.Point, liveCp2?: fabric.Point) => {
        clearTemp()
        if (anchors.length === 0) { canvas.requestRenderAll(); return }

        // Path comprometido hasta ahora
        if (anchors.length >= 2) {
          const previewPathStr = buildPenPath(anchors)
          addTemp(new fabric.Path(previewPathStr, {
            stroke: colorRef.current, strokeWidth: brushSizeRef.current,
            strokeLineCap: previewPathStr.includes(' C ') ? 'round' : 'butt',
            strokeLineJoin: 'miter',
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
        if (liveCp2 && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          drawArm(last.pt, liveCp2)
          drawArm(last.pt, new fabric.Point(last.pt.x * 2 - liveCp2.x, last.pt.y * 2 - liveCp2.y))
        }

        // Preview del segmento al cursor (cuando no se está arrastrando)
        if (cursor && !mouseIsDown && anchors.length >= 1) {
          const last = anchors[anchors.length - 1]
          const cp1  = last.cp2
          const straight = cp1.x === last.pt.x && cp1.y === last.pt.y
          const seg = straight
            ? `M ${last.pt.x} ${last.pt.y} L ${cursor.x} ${cursor.y}`
            : `M ${last.pt.x} ${last.pt.y} C ${cp1.x} ${cp1.y} ${cursor.x} ${cursor.y} ${cursor.x} ${cursor.y}`
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

        canvas.requestRenderAll()
      }

      const commit = (closed = false) => {
        clearTemp()
        if (anchors.length >= 2) {
          snapPoints.current.push(new fabric.Point(anchors[0].pt.x, anchors[0].pt.y))
          const lastPt = anchors[anchors.length - 1].pt
          if (!closed) snapPoints.current.push(new fabric.Point(lastPt.x, lastPt.y))
          const penPathStr = buildPenPath(anchors, closed)
          const obj = new fabric.Path(penPathStr, {
            stroke: colorRef.current, strokeWidth: brushSizeRef.current,
            strokeLineCap: penPathStr.includes(' C ') ? 'round' : 'butt',
            strokeLineJoin: 'miter',
            fill: null, selectable: false, evented: true,
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
        const now = Date.now()
        const pt  = e.scenePoint

        // Modo edición de anclajes (solo si no estamos dibujando)
        if (anchors.length === 0) {
          for (let i = 0; i < aHandles.length; i++) {
            const h = aHandles[i]
            const hx = (h.circle.left as number) + ANCHOR_R
            const hy = (h.circle.top  as number) + ANCHOR_R
            if (Math.hypot(pt.x - hx, pt.y - hy) < ANCHOR_HIT) { deleteAnchor(i); return }
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
        const pt = e.scenePoint
        cursorPt = pt

        // Cursor dinámico en modo edición
        if (anchors.length === 0) {
          let overHandle = false
          for (const h of aHandles) {
            const hx = (h.circle.left as number) + ANCHOR_R
            const hy = (h.circle.top  as number) + ANCHOR_R
            if (Math.hypot(pt.x - hx, pt.y - hy) < ANCHOR_HIT) { overHandle = true; break }
          }
          const cur = overHandle ? PEN_DEL_CURSOR
            : (editObj && nearPathSegmentIdx(editObj, pt, 8) >= 0) ? PEN_ADD_CURSOR
            : PEN_CURSOR
          applyPenCursor(cur)
        }

        // Indicador de cierre
        isClosing = anchors.length >= 2
          && Math.hypot(pt.x - anchors[0].pt.x, pt.y - anchors[0].pt.y) < SNAP_RADIUS

        // Arrastrar handle del último ancla
        let liveCp2: fabric.Point | undefined
        if (mouseIsDown && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          if (Math.hypot(pt.x - last.pt.x, pt.y - last.pt.y) > 4) {
            draggingHandle = true
            last.cp2 = new fabric.Point(pt.x, pt.y)
            last.cp1 = new fabric.Point(last.pt.x * 2 - pt.x, last.pt.y * 2 - pt.y)
            liveCp2  = last.cp2
          }
        }

        redraw(pt, liveCp2)
      }

      const onUp = () => { mouseIsDown = false; draggingHandle = false; redraw(cursorPt) }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'Escape') commit()
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
        })
        if (smoothAnchors !== null) (newPath as any).__smoothAnchors = Array.from(smoothAnchors)
        ;(newPath as any).hoverCursor = CURVE_CURSOR
        undoHistory.current.push({ type: 'modify', prev: editObj, next: newPath })
        canvas.remove(editObj); canvas.add(newPath)
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

      const showAnchors = (obj: fabric.FabricObject) => {
        clearAnchorHandles(aHandles, canvas)
        editObj  = obj
        aHandles = buildAnchorHandles(obj, canvas)
        selectedAnchorIdx = null
        const stored = (obj as any).__smoothAnchors
        if (stored) {
          smoothAnchors = new Set(stored as number[])
        } else if ((obj as any).path) {
          const cmds = (obj as fabric.Path).path as any[][]
          // Solo tratar como todo-corners si el path es 100% recto (sin ningún C)
          const isAllStraight = cmds.every(c => c[0] === 'M' || c[0] === 'L' || c[0] === 'Z')
          smoothAnchors = isAllStraight ? new Set<number>() : null
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
          })
          if (smoothAnchors !== null)
            (newObj as any).__smoothAnchors = Array.from(smoothAnchors)
        }

        ;(newObj as any).hoverCursor = CURVE_CURSOR
        canvas.remove(editObj); canvas.add(newObj)
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
            // Make the dragged anchor smooth so adjacent segments always curve
            if (smoothAnchors !== null && !smoothAnchors.has(i)) {
              smoothAnchors = new Set(smoothAnchors)
              smoothAnchors.add(i)
            }
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
              })
              ;(newPath as any).__smoothAnchors = Array.from(smoothAnchors)
              ;(newPath as any).hoverCursor = CURVE_CURSOR
              canvas.remove(editObj); canvas.add(newPath)
              undoHistory.current.push({ type: 'modify', prev: editObj, next: newPath })
              editObj = newPath
              aHandles = buildAnchorHandles(newPath, canvas)
              redoHistory.current = []
              canvas.requestRenderAll()
              return
            }
          }
        }

        // ¿Click en trazado dibujado?
        const target = e.target
        if (target && !mockupObjects.current.includes(target) && isDrawnPathOrLine(target)) {
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
      let removedThisStroke: fabric.FabricObject[] = []

      const onDown  = () => { isMouseDown.current = true; removedThisStroke = [] }
      const onUp    = () => {
        isMouseDown.current = false
        if (removedThisStroke.length > 0) {
          removedThisStroke.forEach(obj => undoHistory.current.push({ type: 'remove', obj }))
          redoHistory.current = []
          removedThisStroke = []
        }
      }

      const onMove = (e: fabric.TPointerEventInfo) => {
        const p = e.scenePoint
        const r = brushSizeRef.current
        showSizeCursor((e.e as MouseEvent).clientX, (e.e as MouseEvent).clientY)

        if (isMouseDown.current) {
          const toRemove = canvas.getObjects().filter(obj => {
            if (mockupObjects.current.includes(obj)) return false
            const b = obj.getBoundingRect()
            return (
              b.left              < p.x + r &&
              b.left + b.width    > p.x - r &&
              b.top               < p.y + r &&
              b.top  + b.height   > p.y - r
            )
          })
          if (toRemove.length > 0) {
            toRemove.forEach(obj => { canvas.remove(obj); removedThisStroke.push(obj) })
          }
        }
        canvas.requestRenderAll()
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

    // ── Select ───────────────────────────────────────────────────────────────
    if (tool === 'select') {
      const syncProps = (obj: fabric.FabricObject | null) => {
        if (!obj) { setHasSel(false); setIsText(false); return }
        setHasSel(true)
        setPropFill(typeof obj.fill   === 'string' ? obj.fill   : null)
        setPropStroke(typeof obj.stroke === 'string' ? obj.stroke : '#000000')
        setPropSWidth(obj.strokeWidth ?? 1)
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

      canvas.on('selection:created', onCreated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:cleared', onCleared)

      offs.push(() => {
        canvas.off('selection:created', onCreated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:cleared', onCleared)
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
    const obj = fc.current?.getActiveObject()
    if (obj && !mockupObjects.current.includes(obj)) {
      obj.set({ strokeWidth: clamped })
      fc.current?.requestRenderAll()
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

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = canvas.getActiveObject()
        if (active && !mockupObjects.current.includes(active) && !(active instanceof fabric.IText && (active as fabric.IText).isEditing)) {
          e.preventDefault()
          undoHistory.current.push({ type: 'remove', obj: active })
          canvas.remove(active)
          canvas.discardActiveObject()
          canvas.requestRenderAll()
          redoHistory.current = []
          return
        }
      }

      const ctrl = e.ctrlKey || e.metaKey

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

      // Don't intercept Ctrl+Z/Shift+Z when editing text
      const editingText = canvas.getActiveObject()
      if (editingText instanceof fabric.IText && (editingText as fabric.IText).isEditing) return

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
          <ToolBtn icon="↖" label="Seleccionar (V)"   active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon="✏" label="Pincel libre"       active={tool === 'draw'}    onClick={() => setTool('draw')} />
          <ToolBtn icon="✎" label="Lápiz"             active={tool === 'pencil'}  onClick={() => setTool('pencil')} />
          <ToolBtn icon="🖊" label="Pluma"             active={tool === 'pen'}    onClick={() => setTool('pen')} />
          <ToolBtn icon="∿" label="Pluma curvatura"   active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="T" label="Texto"              active={tool === 'text'}   onClick={() => setTool('text')} />
          <ToolBtn icon="◻" label="Goma"              active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon="▣" label="Relleno"            active={tool === 'fill'}   onClick={() => setTool('fill')} />
          <div className="editor-toolbar-divider" />
          <div className="editor-hint">Ctrl+Z<br/>Ctrl+⇧Z</div>
        </aside>

        {/* ── Canvas ── */}
        <main className="editor-canvas-area" ref={canvasAreaRef as RefObject<HTMLElement>}>
          <canvas ref={canvasEl} />
          <div ref={cursorRef} className="editor-size-cursor" />
          {tool === 'pen' && (
            <div className="editor-pen-hint">
              Click · agregar &nbsp;|&nbsp; Doble-click / Enter · terminar &nbsp;|&nbsp; Esc · cancelar
            </div>
          )}
          {tool === 'curve' && (
            <div className="editor-pen-hint">
              Click ancla · seleccionar &nbsp;|&nbsp; Arrastrar · mover &nbsp;|&nbsp; Supr · eliminar ancla
            </div>
          )}
          {tool === 'text' && (
            <div className="editor-pen-hint">
              Click en el canvas para colocar texto
            </div>
          )}
        </main>

        {/* ── Right properties panel ── */}
        <aside className="editor-props">

          {/* Tipografía — solo cuando hay texto seleccionado */}
          {isText && (
            <div className="prop-section">
              <span className="prop-label">Tipografía</span>
              <select
                value={propFontFamily}
                onChange={e => applyFontFamily(e.target.value)}
                className="prop-font-select"
              >
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <div className="prop-weight-row">
                <span className="prop-weight-label">Tamaño</span>
                <div className="prop-weight-input-wrap">
                  <input
                    type="number"
                    min={6} max={400} step={1}
                    value={propFontSize}
                    onChange={e => applyFontSize(Number(e.target.value))}
                    className="prop-weight-input"
                  />
                  <span className="prop-weight-unit">px</span>
                </div>
              </div>
            </div>
          )}

          {/* Relleno */}
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

          {/* Trazado */}
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
