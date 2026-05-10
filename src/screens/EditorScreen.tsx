import React, { useEffect, useRef, useState, type RefObject } from 'react'
import * as fabric from 'fabric'
import { Project } from '../types/project'
import { SYSTEM_FONTS, GOOGLE_FONTS, loadGoogleFont, loadUserFont, restoreUserFonts, deleteUserFont } from '../utils/fonts'
import './EditorScreen.css'

interface EditorActions { save: () => void; export: () => void }

interface Props {
  project: Project
  onSave: (thumbnail: string, canvasJson: string) => void
  saved: boolean
  onSaveComplete: () => void
  onActionsReady: (a: EditorActions | null) => void
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

// Reconstruye un path mezclando segmentos rectos (corners) y curvas suaves.
// Usa la dirección tangente Catmull-Rom pero escala cada handle a 1/3 del segmento
// actual (chord-length parameterization). Esto evita que handles en segmentos cortos
// sean demasiado grandes (curvas exageradas) o pequeños (puntas afiladas) cuando los
// vecinos están muy lejos o muy cerca, dando transiciones equilibradas en cualquier polígono.
function buildMixedPath(positions: fabric.Point[], smoothAnchors: Set<number>, closed = false): string {
  const n = positions.length
  if (n < 2) return ''

  // Helper: tangent-scaled handle at point P in direction (toward - away), length = segLen/3
  function scaledHandle(
    P: fabric.Point, toward: fabric.Point, away: fabric.Point, segLen: number, sign: 1 | -1,
  ): [number, number] {
    const tx = toward.x - away.x
    const ty = toward.y - away.y
    const tLen = Math.hypot(tx, ty)
    if (tLen < 1e-9 || segLen < 1e-9) return [P.x, P.y]
    const sc = (segLen / 3) / tLen * sign
    return [P.x + tx * sc, P.y + ty * sc]
  }

  let d = `M ${positions[0].x} ${positions[0].y}`
  const segments = closed ? n : n - 1

  for (let j = 0; j < segments; j++) {
    const j1  = (j + 1) % n
    const Pj  = positions[j]
    const Pj1 = positions[j1]
    const s0  = smoothAnchors.has(j)
    const s1  = smoothAnchors.has(j1)

    if (!s0 && !s1) { d += ` L ${Pj1.x} ${Pj1.y}`; continue }

    const segLen = Math.hypot(Pj1.x - Pj.x, Pj1.y - Pj.y)

    // Catmull-Rom neighbor lookup (wrap/clamp for open paths)
    const jPrev  = j   === 0     ? (closed ? n - 1 : 0)     : j   - 1
    const j1Next = j1  === n - 1 ? (closed ? 0     : n - 1) : j1  + 1
    const pPrev  = positions[jPrev]
    const pNext  = positions[j1Next]

    let cp1x: number, cp1y: number
    if (!s0) {
      cp1x = Pj.x; cp1y = Pj.y           // corner → zero-length outgoing handle
    } else {
      // Tangent direction at Pj: from pPrev toward Pj1, scaled to segLen/3
      ;[cp1x, cp1y] = scaledHandle(Pj, Pj1, pPrev, segLen, 1)
    }

    let cp2x: number, cp2y: number
    if (!s1) {
      cp2x = Pj1.x; cp2y = Pj1.y         // corner → zero-length incoming handle
    } else {
      // Tangent direction at Pj1: from Pj toward pNext, scaled to segLen/3
      ;[cp2x, cp2y] = scaledHandle(Pj1, pNext, Pj, segLen, -1)
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

// Lápiz: punta abajo-izquierda, borrador arriba-derecha
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect x='8' y='1' width='5' height='12' rx='1' fill='%23f5c842' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='8,13 13,13 10.5,18' fill='%23e8a87c' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='9.5,16.5 11.5,16.5 10.5,18' fill='%23222'/%3E%3Crect x='8' y='1' width='5' height='3' rx='1' fill='%23bbb' stroke='%23333' stroke-width='1'/%3E%3C/svg%3E") 10 18, crosshair`


export default function EditorScreen({ project, onSave, saved, onSaveComplete, onActionsReady }: Props) {
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
  const fontFamilyRef = useRef('Arial')
  const isMouseDown   = useRef(false)
  const snapPoints    = useRef<fabric.Point[]>([])

  const [tool, setTool] = useState<Tool>('select')
  const [zoom,   setZoom]   = useState(1)
  const [panned, setPanned] = useState(false)
  const [rightTab,     setRightTab]     = useState<'props' | 'layers'>('props')
  const [layers,       setLayers]       = useState<fabric.FabricObject[]>([])
  const [selectedObj,  setSelectedObj]  = useState<fabric.FabricObject | null>(null)

  const [hasSel,        setHasSel]        = useState(false)
  const [isText,        setIsText]        = useState(false)
  const [propFill,      setPropFill]      = useState<string | null>(null)
  const [propStroke,    setPropStroke]    = useState('#ff6b00')
  const [propSWidth,    setPropSWidth]    = useState(8)
  const [propFontFamily, setPropFontFamily] = useState('Arial')
  const [propFontSize,  setPropFontSize]  = useState(24)
  const [userFonts,      setUserFonts]      = useState<string[]>([])
  const [fontPickerOpen, setFontPickerOpen] = useState(false)
  const [fontFilter,     setFontFilter]     = useState('')
  const [fontLoading,    setFontLoading]    = useState(false)

  useEffect(() => { colorRef.current      = propStroke    }, [propStroke])
  useEffect(() => { brushSizeRef.current  = propSWidth    }, [propSWidth])
  useEffect(() => { fontFamilyRef.current = propFontFamily }, [propFontFamily])
  useEffect(() => { restoreUserFonts().then(names => { if (names.length) setUserFonts(names) }) }, [])

  // Register save/export actions for ChromeBar
  useEffect(() => {
    const handleSaveRef = () => handleSave()
    const handleExportRef = () => handleExport()
    onActionsReady({ save: handleSaveRef, export: handleExportRef })
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

    const refreshLayers = () => setLayers([...canvas.getObjects()])
    canvas.on('object:added',   refreshLayers)
    canvas.on('object:removed', refreshLayers)
    canvas.on('object:modified', refreshLayers)

    canvas.on('selection:created', (e: any) => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:updated', (e: any) => setSelectedObj(e.selected?.[0] ?? null))
    canvas.on('selection:cleared', () => setSelectedObj(null))

    // Keep stroke width visually constant when scaling
    // Capture pre-scale values on mouse:down because Fabric v6 doesn't include
    // strokeWidth in e.transform.original during object:scaling
    canvas.on('mouse:down', () => {
      const obj = canvas.getActiveObject()
      if (!obj) return
      ;(obj as any)._preSW = obj.strokeWidth ?? 0
      ;(obj as any)._preSX = obj.scaleX ?? 1
      ;(obj as any)._preSY = obj.scaleY ?? 1
    })
    canvas.on('object:scaling', (e: any) => {
      const obj = e.target
      if (!obj) return
      const preSW = (obj as any)._preSW
      if (!preSW) return
      const preSX = (obj as any)._preSX ?? 1
      const preSY = (obj as any)._preSY ?? 1
      const curSX = obj.scaleX ?? 1
      const curSY = obj.scaleY ?? 1
      const factor = Math.sqrt((curSX / preSX) * (curSY / preSY))
      obj.strokeWidth = Math.max(0.1, preSW / factor)
    })

    // Marquee selection box — thin solid line, barely visible fill
    canvas.selectionColor       = 'rgba(29, 119, 224, 0.04)'
    canvas.selectionBorderColor = '#1D77E0'
    canvas.selectionLineWidth   = 1
    ;(canvas as any).selectionDashArray = []
    ;(canvas as any).uniformScaling     = false
    canvas.skipOffscreen = false

    // Illustrator-style handle renderer: small white square, 1px blue stroke
    const AI_HANDLE_SIZE = 6
    function renderAIHandle(ctx: CanvasRenderingContext2D, left: number, top: number) {
      const h = AI_HANDLE_SIZE
      ctx.save()
      ctx.fillStyle   = '#ffffff'
      ctx.strokeStyle = '#1D77E0'
      ctx.lineWidth   = 1
      ctx.fillRect(  left - h / 2, top - h / 2, h, h)
      ctx.strokeRect(left - h / 2, top - h / 2, h, h)
      ctx.restore()
    }

    Object.assign(fabric.FabricObject.prototype, {
      borderColor:       '#1D77E0',
      borderScaleFactor: 1,
      cornerSize:        AI_HANDLE_SIZE + 4,
      cornerStyle:       'rect',
      transparentCorners: true,
      padding:            4,
    })

    try {
      const controls = fabric.FabricObject.prototype.controls
      Object.keys(controls).forEach(key => {
        if (key === 'mtr') {
          controls[key].visible = false
        } else {
          controls[key].render = renderAIHandle as any
        }
      })
    } catch (_) {}

    const svgUrl = `/mockups/${project.mockupId}.svg`

    fabric.loadSVGFromURL(svgUrl).then(async ({ objects }) => {
      if (cancelled) return
      const objs = objects.filter(Boolean) as fabric.FabricObject[]
      mockupObjects.current = objs

      objs.forEach(obj => {
        ;(obj as any)._rawMockup = true
        obj.set({ selectable: false, evented: true, hoverCursor: 'crosshair' })
      })
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

      // Restore saved user objects if any
      if (project.canvasJson) {
        try {
          const saved = JSON.parse(project.canvasJson) as object[]
          const revived = await (fabric.util as any).enlivenObjects(saved) as fabric.FabricObject[]
          for (const obj of revived) {
            obj.set({ strokeUniform: true })
            if (!(obj instanceof fabric.IText) && clipPath.current) {
              obj.set({ clipPath: clipPath.current })
            }
            canvas.add(obj)
          }
          canvas.requestRenderAll()
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
      setZoom(newZoom)
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
      setPanned(true)
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

        // Path comprometido hasta ahora
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
        if (liveCp2 && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          drawArm(last.pt, liveCp2)
          drawArm(last.pt, new fabric.Point(last.pt.x * 2 - liveCp2.x, last.pt.y * 2 - liveCp2.y))
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
          autoSmoothCorners(anchors, closed)
          snapPoints.current.push(new fabric.Point(anchors[0].pt.x, anchors[0].pt.y))
          const lastPt = anchors[anchors.length - 1].pt
          if (!closed) snapPoints.current.push(new fabric.Point(lastPt.x, lastPt.y))
          const penPathStr = buildPenPath(anchors, closed)
          const obj = new fabric.Path(penPathStr, {
            stroke: colorRef.current, strokeWidth: brushSizeRef.current,
            strokeLineCap: penPathStr.includes(' C ') ? 'round' : 'butt',
            strokeLineJoin: 'round',
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
          const cur = overHandle ? PEN_DEL_CURSOR
            : (editObj && nearPathSegmentIdx(editObj, rawPt, 8) >= 0) ? PEN_ADD_CURSOR
            : PEN_CURSOR
          applyPenCursor(cur)
        }

        // Indicador de cierre (basado en posición snapeada)
        isClosing = anchors.length >= 2
          && Math.hypot(snappedPt.x - anchors[0].pt.x, snappedPt.y - anchors[0].pt.y) < SNAP_RADIUS

        // Arrastrar handle del último ancla (sin snap — dirección libre)
        let liveCp2: fabric.Point | undefined
        if (mouseIsDown && anchors.length > 0) {
          const last = anchors[anchors.length - 1]
          if (Math.hypot(rawPt.x - last.pt.x, rawPt.y - last.pt.y) > 4) {
            draggingHandle = true
            last.cp2 = new fabric.Point(rawPt.x, rawPt.y)
            last.cp1 = new fabric.Point(last.pt.x * 2 - rawPt.x, last.pt.y * 2 - rawPt.y)
            liveCp2  = last.cp2
          }
        }

        redraw(snappedPt, liveCp2, guides, nodeSnap)
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
            // Any corner sandwiched between two smooth anchors inherits smoothness.
            const n = positions.length
            const extended = new Set(smoothAnchors)
            for (let i = 0; i < n; i++) {
              if (extended.has(i)) continue
              const prev = isClosed ? (i - 1 + n) % n : i - 1
              const next = isClosed ? (i + 1) % n : i + 1
              if (prev >= 0 && next < n && extended.has(prev) && extended.has(next))
                extended.add(i)
            }
            smoothAnchors = extended
            d = buildMixedPath(positions, extended, isClosed)
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
            // If this corner sits between two smooth anchors, smooth it on drag start.
            // This preserves corners next to straight segments but flows curves correctly.
            if (smoothAnchors !== null && !smoothAnchors.has(i)) {
              const n = aHandles.length
              const pathCmds = (editObj as any).path
                ? ((editObj as fabric.Path).path as any[][]) : null
              const isClosed = !!pathCmds && pathCmds.some((c: any[]) => c[0] === 'Z')
              const prevIdx = i > 0 ? i - 1 : (isClosed ? n - 1 : -1)
              const nextIdx = i < n - 1 ? i + 1 : (isClosed ? 0 : -1)
              if (prevIdx >= 0 && nextIdx >= 0
                && smoothAnchors.has(prevIdx) && smoothAnchors.has(nextIdx)) {
                smoothAnchors = new Set(smoothAnchors)
                smoothAnchors.add(i)
              }
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

      const onScaled = (e: any) => syncProps(e.target ?? null)

      canvas.on('selection:created', onCreated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
      canvas.on('selection:cleared', onCleared)
      canvas.on('object:scaled',    onScaled)

      offs.push(() => {
        canvas.off('selection:created', onCreated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:updated', onUpdated as Parameters<typeof canvas.on>[1])
        canvas.off('selection:cleared', onCleared)
        canvas.off('object:scaled',    onScaled)
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
    const userObjs = canvas.getObjects()
      .filter(o => !(o as any)._rawMockup)
      .map(o => { const j = o.toJSON(); delete j.clipPath; return j })
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

  function resetView() {
    const canvas = fc.current
    if (!canvas) return
    canvas.setZoom(1)
    canvas.absolutePan(new fabric.Point(0, 0))
    canvas.requestRenderAll()
    setZoom(1)
    setPanned(false)
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
          <ToolBtn icon="↖" label="Seleccionar (V)"  active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolBtn icon={<IconBrush />} label="Pincel libre" active={tool === 'draw'}   onClick={() => setTool('draw')} />
          <ToolBtn icon="✎" label="Lápiz"            active={tool === 'pencil'} onClick={() => setTool('pencil')} />
          <ToolBtn icon="🖊" label="Pluma"            active={tool === 'pen'}   onClick={() => setTool('pen')} />
          <ToolBtn icon="∿" label="Pluma curvatura"  active={tool === 'curve'}  onClick={() => setTool('curve')} />
          <ToolBtn icon="T" label="Texto"             active={tool === 'text'}   onClick={() => setTool('text')} />
          <ToolBtn icon={<IconEraser />} label="Goma"    active={tool === 'eraser'} onClick={() => setTool('eraser')} />
          <ToolBtn icon={<IconBucket />} label="Relleno" active={tool === 'fill'}   onClick={() => setTool('fill')} />
          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--line-soft)', paddingTop: 8, width: '100%' }}>
            <div className="mono" style={{ fontSize: 8, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.8 }}>Z<br/>⇧Z</div>
          </div>
        </aside>

        {/* Canvas */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-2)' }}
          ref={canvasAreaRef as RefObject<HTMLElement>}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(circle, var(--line-soft) 1px, transparent 1px)',
            backgroundSize: '20px 20px', opacity: 0.4,
          }} />
          <canvas ref={canvasEl} />
          <div ref={cursorRef} className="editor-size-cursor" />
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
              {tool === 'pen'   && 'Click · agregar  |  Doble-click / Enter · terminar  |  Esc · cancelar'}
              {tool === 'curve' && 'Click ancla · seleccionar  |  Arrastrar · mover  |  Supr · eliminar ancla'}
              {tool === 'text'  && 'Click en el canvas para colocar texto'}
            </div>
          )}
        </main>

        {/* Right panel */}
        <aside style={{
          width: 232, flexShrink: 0, borderLeft: '1px solid var(--line-soft)',
          display: 'flex', flexDirection: 'column', background: 'var(--bg)',
        }}>
          {/* Tabs */}
          <div style={{
            display: 'flex', flexShrink: 0,
            borderBottom: '1px solid var(--line-soft)',
          }}>
            {(['props', 'layers'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1, height: 36, border: 'none', borderRadius: 0, cursor: 'pointer',
                  background: rightTab === tab ? 'var(--surface)' : 'transparent',
                  borderBottom: '2px solid ' + (rightTab === tab ? 'var(--accent)' : 'transparent'),
                  color: rightTab === tab ? 'var(--fg)' : 'var(--muted)',
                  fontSize: 11, fontFamily: 'var(--ui)', letterSpacing: '0.06em',
                  transition: 'all 0.15s var(--ease)',
                }}
              >
                {tab === 'props' ? 'Propiedades' : 'Capas'}
              </button>
            ))}
          </div>

          {/* Properties tab */}
          {rightTab === 'props' && <div style={{ overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number" min={6} max={400} step={1}
                    value={propFontSize}
                    onChange={e => applyFontSize(Number(e.target.value))}
                    style={{
                      width: 56, padding: '5px 8px', borderRadius: 6, textAlign: 'right',
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      color: 'var(--fg)', fontFamily: 'var(--mono)', fontSize: 12,
                    }}
                  />
                  <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>px</span>
                </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min={0.5} max={200} step={0.5}
                  value={propSWidth}
                  onChange={e => applyStrokeWidth(Number(e.target.value))}
                  onBlur={e  => applyStrokeWidth(Number(e.target.value))}
                  style={{
                    width: 56, padding: '5px 8px', borderRadius: 6, textAlign: 'right',
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    color: 'var(--fg)', fontFamily: 'var(--mono)', fontSize: 12,
                  }}
                />
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>px</span>
              </div>
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
                selectedObj={selectedObj}
                onSelect={obj => {
                  const canvas = fc.current
                  if (!canvas) return
                  setTool('select')
                  setSelectedObj(obj)
                  canvas.isDrawingMode = false
                  canvas.selection = true
                  obj.selectable = true
                  obj.evented = true
                  canvas.setActiveObject(obj)
                  canvas.requestRenderAll()
                }}
              />
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
    </div>
  )
}

// ── Layers panel ─────────────────────────────────────────────────────────────

type LayerGroup = { label: string; icon: string; items: fabric.FabricObject[] }

function getLayerLabel(obj: fabric.FabricObject): string {
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

function LayersPanel({ layers, selectedObj, onSelect }: {
  layers: fabric.FabricObject[]
  selectedObj: fabric.FabricObject | null
  onSelect: (obj: fabric.FabricObject) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const mockup   = layers.filter(o => (o as any)._rawMockup)
  const texts    = layers.filter(o => !((o as any)._rawMockup) && ((o as any).type === 'i-text' || (o as any).type === 'text'))
  const paths    = layers.filter(o => !((o as any)._rawMockup) && ((o as any).type === 'path' || (o as any).type === 'line'))
  const others   = layers.filter(o => !((o as any)._rawMockup) && (o as any).type !== 'i-text' && (o as any).type !== 'text' && (o as any).type !== 'path' && (o as any).type !== 'line')

  const groups: LayerGroup[] = [
    { label: 'Trazados',  icon: '∿', items: [...paths].reverse()  },
    { label: 'Texto',     icon: 'T', items: [...texts].reverse()  },
    { label: 'Otros',     icon: '▭', items: [...others].reverse() },
    { label: 'Mockup',    icon: '◈', items: [...mockup].reverse() },
  ].filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        Sin capas
      </div>
    )
  }

  function toggle(label: string) {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <div>
      {groups.map(group => (
        <div key={group.label}>
          {/* Group header */}
          <button
            onClick={() => toggle(group.label)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 12px', border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontFamily: 'var(--ui)', fontSize: 10,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              borderBottom: '1px solid var(--line-soft)',
            }}
          >
            <span style={{ fontSize: 9, transition: 'transform 0.15s', transform: collapsed[group.label] ? 'rotate(-90deg)' : 'none' }}>▾</span>
            <span style={{ fontSize: 11, marginRight: 2 }}>{group.icon}</span>
            {group.label}
            <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{group.items.length}</span>
          </button>

          {/* Layer rows */}
          {!collapsed[group.label] && group.items.map((obj, i) => {
            const isSelected = obj === selectedObj
            return (
              <button
                key={i}
                onClick={() => onSelect(obj)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px 6px 24px', border: 'none',
                  background: isSelected ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'none',
                  borderLeft: '2px solid ' + (isSelected ? 'var(--accent)' : 'transparent'),
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui)', fontSize: 11,
                  color: isSelected ? 'var(--fg)' : 'var(--fg-2)',
                  borderBottom: '1px solid var(--line-soft)',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--fg)' } }}
                onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--fg-2)' } }}
              >
                <span style={{ fontSize: 10, color: isSelected ? 'var(--accent)' : 'var(--muted)', width: 12, textAlign: 'center', flexShrink: 0 }}>{getLayerIcon(obj)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getLayerLabel(obj)}</span>
              </button>
            )
          })}
        </div>
      ))}
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

const IconBrush = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="7.2" y="0.5" width="2.8" height="8" rx="1.4" transform="rotate(40 8.6 4.5)" />
    <rect x="5.5" y="8.5" width="5" height="2" rx="0.4" />
    <ellipse cx="8" cy="13.5" rx="2.5" ry="2" />
  </svg>
)

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
