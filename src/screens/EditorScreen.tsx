import React, { useEffect, useRef, useState, type RefObject } from 'react'
import * as fabric from 'fabric'
import { Project, TechPackMeasures } from '../types/project'
import { SYSTEM_FONTS, GOOGLE_FONTS, loadGoogleFont, loadUserFont, restoreUserFonts, deleteUserFont } from '../utils/fonts'
import { importUserTexture, listUserTextures, deleteUserTexture, updateUserTexture,
         TEXTURE_ACCEPT, type UserTexture } from '../utils/userTextures'
import { RAW_TEXTURES, isRawTexture, rawTextureById, loadRawWidths, saveRawWidth,
         loadRawPalettes, saveRawPalette } from '../utils/rawTextures'
import { readSvgColors, sortColorsByArea, recolorSvg, dominantColor, tintImage,
         shiftPalette, sameColors, loadImage, svgToDataUrl } from '../utils/rawRecolor'
import { transformPath } from '../utils/pathWarp'
import { prepararParaCalco, esColorDeFondo } from '../utils/calco'
import ColorPicker from '../components/ColorPicker'
import { aplanarPath, poligonoAPath, partirPoligono, type Punto } from '../utils/dividir'
import { PRENDAS_PARAM, leerPiezasSvg, type Medidas, type PiezaSvg, type PrendaParam } from '../utils/prendasParam'
import './EditorScreen.css'

interface EditorActions { save: () => void; export: () => void; importImage: (f: File) => void; placeImage: (f: File) => void; techpack: () => void }

interface Props {
  project: Project
  designer: string
  // Devuelve si el guardado llego a la base. Sin ese dato el editor
  // cantaba "Guardado" aunque hubiera fallado.
  onSave: (thumbnail: string, canvasJson: string) => Promise<boolean>
  saved: boolean
  onSaveComplete: () => void
  onActionsReady: (a: EditorActions | null) => void
  onOpenTechPack: (snapshot: string, measures: TechPackMeasures | null) => void
  onToast?: (msg: string) => void
}

type Tool = 'select' | 'pencil' | 'pen' | 'curve' | 'eraser' | 'fill' | 'text' | 'eyedropper'
  | 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'rrect'
  | 'symbol' | 'hand' | 'zoom'

// Estilo de trazado especial aplicable a lo que se dibuja con lápiz / pluma
type StrokeStyle = 'normal' | 'bordado' | 'cierre' | 'costura'

// Lo que hay que guardar para poder deshacer un cambio de relleno.
//
// No alcanza con el color/patrón que se ve: una pieza pintada guarda además la
// RECETA de cómo se pintó (_texture, _userTex, _baseColor, _effect), y es la
// receta la que se guarda en el proyecto y la que se vuelve a dibujar cuando
// cambian las medidas o los colores de la tela.
//
// Antes acá solo se guardaba `fill`. Entonces Ctrl+Z devolvía el aspecto pero
// la pieza seguía "acordándose" de la tela deshecha: al guardar, al cambiar una
// medida o al tocar un color, la tela volvía sola. Los dos síntomas —el Ctrl+Z
// que no deshace y el guardado que trae de vuelta lo borrado— eran esto.
interface PaintSnap {
  fill: fabric.TFiller | string | null
  tex?:  { kind: TextureKind; colors: string[] }
  eff?:  { kind: EffectKind; intensity: number }
  base?: string
  uTex?: { id: string; widthCm: number }
}

function snapshotPaint(obj: fabric.FabricObject): PaintSnap {
  const o = obj as any
  return { fill: o.fill ?? null, tex: o._texture, eff: o._effect, base: o._baseColor, uTex: o._userTex }
}

// Repone la receta EXACTA: lo que el snapshot no tiene, se borra. Si solo se
// asignara lo presente, deshacer "le puse tela a una pieza que era lisa" dejaría
// la tela puesta.
function applyPaint(obj: fabric.FabricObject, s: PaintSnap): void {
  const o = obj as any
  if (s.tex)  o._texture   = s.tex;  else delete o._texture
  if (s.eff)  o._effect    = s.eff;  else delete o._effect
  if (s.base) o._baseColor = s.base; else delete o._baseColor
  if (s.uTex) o._userTex   = s.uTex; else delete o._userTex
  obj.set({ fill: s.fill as string, dirty: true })
}

/** Dónde estaba y cómo estaba un objeto, para poder devolverlo ahí. */
interface GeomSnap {
  obj: fabric.FabricObject
  left: number; top: number
  scaleX: number; scaleY: number
  angle: number
}

const snapGeom = (o: fabric.FabricObject): GeomSnap => ({
  obj: o,
  left: o.left ?? 0, top: o.top ?? 0,
  scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
  angle: o.angle ?? 0,
})

function applyGeom(s: GeomSnap): void {
  s.obj.set({ left: s.left, top: s.top, scaleX: s.scaleX, scaleY: s.scaleY, angle: s.angle })
  s.obj.setCoords()
}

type HistoryEntry =
  | { type: 'add';    obj: fabric.FabricObject }
  | { type: 'remove'; obj: fabric.FabricObject }
  | { type: 'fill';    obj: fabric.FabricObject; prev: PaintSnap }
  | { type: 'fillBatch'; items: { obj: fabric.FabricObject; prev: PaintSnap }[] }
  | { type: 'opacity'; obj: fabric.FabricObject; prevOpacity: number }
  | { type: 'modify'; prev: fabric.FabricObject; next: fabric.FabricObject }
  | { type: 'erase';  removed: fabric.FabricObject[]; added: fabric.FabricObject[] }
  | { type: 'group';   children: fabric.FabricObject[]; group: fabric.Group }
  | { type: 'ungroup'; children: fabric.FabricObject[]; group: fabric.Group }
  // Mover, escalar o rotar. Guarda la geometría COMPLETA y no solo la posición:
  // con left/top sueltos, deshacer un escalado devolvía el objeto a su lugar
  // pero con el tamaño nuevo.
  | { type: 'transform'; items: GeomSnap[] }
  // Arrastre de varios objetos a la vez. Va por separado porque mientras hay una
  // selección múltiple las coordenadas de cada hijo son relativas al centro de
  // la selección: recién se vuelven absolutas al soltarla. Guardar un left/top
  // de ese momento y reponerlo después manda los objetos a cualquier lado.
  // El desplazamiento, en cambio, vale igual antes y después.
  | { type: 'moveDelta'; objs: fabric.FabricObject[]; dx: number; dy: number }
  | { type: 'props';  obj: fabric.FabricObject; prev: Record<string, any> }

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

// ── Cierre (cremallera) ──────────────────────────────────────────────────────
//
// No es un trazo vectorial: es un PINCEL QUE ESTAMPA, como los packs de
// Procreate. Un cierre de verdad tiene cinta con sombreado, dientes metalicos
// con brillo y una canaleta oscura en el medio; eso no entra en un path de un
// solo color y un solo grosor, por mas que se lo trabaje. Asi que se dibuja en
// un canvas y entra al lienzo como imagen.
//
// El tirador NO va incluido: se agrega aparte, para poder ponerlo donde uno
// quiera y moverlo.

/** Recorre la polilinea a pasos parejos, devolviendo posicion y direccion. */
function recorrer(pts: fabric.Point[], paso: number): { x: number; y: number; ux: number; uy: number }[] {
  const out: { x: number; y: number; ux: number; uy: number }[] = []
  let sobra = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const ux = dx / len, uy = dy / len
    let d = sobra
    while (d < len) {
      out.push({ x: a.x + ux * d, y: a.y + uy * d, ux, uy })
      d += paso
    }
    sobra = d - len
  }
  return out
}

const _mezcla = (a: number[], b: number[], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`

function _rgb(hex: string): number[] {
  const h = (hex || '#3a3a3a').replace('#', '')
  if (h.length < 6) return [58, 58, 58]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Se dibuja a 4x y se muestra a 1x: el cierre es la pieza con mas detalle fino
// de todo el editor y a 2x se notaba dentado al acercarse.
const CIERRE_SUPER = 4
const CIERRE_MAX_PX = 26e6     // techo de memoria del canvas

/**
 * Dibuja el cierre sobre un canvas propio y devuelve dónde va apoyado.
 *
 * El protagonista es la CADENA metálica: dientes anchos, bien separados y con
 * mucho contraste, como en los pinceles de cierre de Procreate. La cinta va
 * angosta y apagada para que no le compita.
 *
 * `color` es el color de la cinta; los dientes son metal.
 */
function dibujarCierre(pts: fabric.Point[], ancho: number, color: string):
    { el: HTMLCanvasElement; left: number; top: number; sup: number } | null {
  if (pts.length < 2) return null
  const w = Math.max(3, ancho)
  const margen = w * 1.6

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
  }
  x0 -= margen; y0 -= margen; x1 += margen; y1 += margen
  const cw = Math.max(4, Math.ceil(x1 - x0)), ch = Math.max(4, Math.ceil(y1 - y0))

  // Si el trazo es enorme se baja la resolución antes que reventar la memoria.
  let S = CIERRE_SUPER
  while (S > 1 && cw * ch * S * S > CIERRE_MAX_PX) S--

  const el = document.createElement('canvas')
  el.width = cw * S; el.height = ch * S
  const x = el.getContext('2d')
  if (!x) return null
  x.scale(S, S); x.translate(-x0, -y0)
  x.lineJoin = 'round'; x.lineCap = 'round'

  const trazar = (lista: [number, number][] | fabric.Point[]) => {
    x.beginPath()
    lista.forEach((p: any, i: number) => {
      const px = Array.isArray(p) ? p[0] : p.x, py = Array.isArray(p) ? p[1] : p.y
      i === 0 ? x.moveTo(px, py) : x.lineTo(px, py)
    })
  }

  const base = _rgb(color)
  const cintaClara = _mezcla(base, [255, 255, 255], 0.12)
  const cintaMedia = base.join(',')
  const cintaBorde = _mezcla(base, [0, 0, 0], 0.30)

  // ── 1. La cinta: apenas asoma a los costados. Si se agranda o se oscurece,
  //    la cadena queda metida adentro de una capsula negra y pierde todo.
  // Punta recta, no redonda: con punta redonda la cinta arma un capuchon en
  // cada extremo y el cierre termina metido dentro de una capsula oscura.
  x.lineCap = 'butt'
  for (const [k, col] of [
    [1.18, cintaBorde],
    [1.12, `rgb(${cintaMedia})`],
    [1.02, cintaClara],
  ] as [number, string][]) {
    trazar(pts); x.strokeStyle = col; x.lineWidth = w * k; x.stroke()
  }
  // sombra suave de la cadena sobre la cinta
  trazar(pts); x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = w * 0.98; x.stroke()
  x.lineCap = 'round'

  // ── 2. La cadena. Cada diente es una barra que cruza el eje; van alternando
  //    un poquito de lado, y ese desfasaje es el que se lee como encastre.
  const paso  = w * 0.46          // de diente a diente
  const largo = w * 0.34          // lo que ocupa el diente a lo largo
  const medio = w * 0.52          // medio ancho del diente
  const corr  = w * 0.045         // corrimiento alternado
  let lado = 1

  for (const q of recorrer(pts, paso)) {
    const ang = Math.atan2(q.uy, q.ux)
    x.save()
    x.translate(q.x, q.y)
    x.rotate(ang)
    const off = lado * corr
    const yA = -medio + off, yB = medio + off

    // Metal: sombra en los cantos, una banda de luz fuerte y un segundo brillo.
    // UNA luz dominante y corrida del centro: asi lee como una barra redondeada.
    // Con muchas bandas el diente se veia rayado en vez de metalico.
    const g = x.createLinearGradient(0, yA, 0, yB)
    g.addColorStop(0.00, '#454b52')
    g.addColorStop(0.16, '#a9b1b9')
    g.addColorStop(0.38, '#ffffff')
    g.addColorStop(0.55, '#dee4e9')
    g.addColorStop(0.80, '#8b929a')
    g.addColorStop(1.00, '#3f444a')
    x.fillStyle = g
    const r = Math.min(largo * 0.45, w * 0.13)
    x.beginPath()
    if ((x as any).roundRect) (x as any).roundRect(-largo / 2, yA, largo, yB - yA, r)
    else x.rect(-largo / 2, yA, largo, yB - yA)
    x.fill()

    // canto oscuro: separa un diente del siguiente
    x.strokeStyle = 'rgba(0,0,0,0.55)'
    x.lineWidth = Math.max(0.35, w * 0.035)
    x.stroke()

    x.restore()
    lado = -lado
  }

  // ── 3. La ranura del medio, donde encastra un lado con el otro.
  trazar(pts); x.strokeStyle = 'rgba(0,0,0,0.30)'; x.lineWidth = w * 0.07; x.stroke()

  return { el, left: x0, top: y0, sup: S }
}

// Costura (pespunte): la linea punteada con la que se marca una costura en un
// dibujo tecnico. Las rayas se calculan sobre el recorrido, asi que siguen la
// curva en vez de estirarse en las vueltas como haria un strokeDashArray.
function seamPathStr(pts: fabric.Point[], width: number): string {
  const w     = Math.max(1, width)
  const raya  = w * 1.9
  const hueco = w * 1.15
  const out: string[] = []
  let resto = 0            // lo que falta de la raya o del hueco en curso
  let pintando = true

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-3) continue
    const ux = dx / len, uy = dy / len
    let d = 0
    while (d < len) {
      if (resto <= 0) { resto = pintando ? raya : hueco }
      const paso = Math.min(resto, len - d)
      if (pintando) {
        const x1 = a.x + ux * d,          y1 = a.y + uy * d
        const x2 = a.x + ux * (d + paso), y2 = a.y + uy * (d + paso)
        out.push(`M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`)
      }
      d += paso
      resto -= paso
      if (resto <= 1e-6) { pintando = !pintando; resto = 0 }
    }
  }
  return out.join(' ')
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
function specialStrokeData(
  pts: fabric.Point[], style: StrokeStyle, width: number,
): { d: string; sw: number; relleno?: boolean } | null {
  if (style === 'bordado') return { d: satinStitchPathStr(pts, width), sw: Math.max(1.4, width * 0.34) }
  // El cierre lleva relleno: los dientes y el cursor son formas cerradas, y sin
  // relleno quedarian como un contorno hueco.
  if (style === 'costura') return { d: seamPathStr(pts, width),   sw: Math.max(1, width * 0.5) }
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
// Conservado a proposito: cursor para el modo 'borrar ancla' (aun sin conectar).
void PEN_DEL_CURSOR
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
  // Chomba y pantalón: los archivos traen frente y espalda en la misma vista,
  // así que la etiqueta tiene que decir de cuál de las dos es cada pieza.
  'body-front': 'Cuerpo frente', 'body-back': 'Cuerpo espalda',
  'sleeve-left-front': 'Manga L frente', 'sleeve-right-front': 'Manga R frente',
  'sleeve-left-back': 'Manga L espalda', 'sleeve-right-back': 'Manga R espalda',
  'cuff-left-front': 'Puño L frente', 'cuff-right-front': 'Puño R frente',
  'cuff-left-back': 'Puño L espalda', 'cuff-right-back': 'Puño R espalda',
  'hem-front': 'Ruedo frente', 'hem-back': 'Ruedo espalda',
  'collar-left-front': 'Cuello L', 'collar-right-front': 'Cuello R',
  'collar-tip-left': 'Punta cuello L', 'collar-tip-right': 'Punta cuello R',
  'collar-band-front': 'Tira del cuello', 'collar-back': 'Cuello espalda',
  'inner-escote': 'Interior del escote',
  'waistband-left': 'Cintura L', 'waistband-right': 'Cintura R',
  'hem-left': 'Ruedo L', 'hem-right': 'Ruedo R',
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

// El gotero del navegador (Chrome/Edge). Deja tomar un color de CUALQUIER parte
// de la pantalla, no solo del lienzo, con lupa incluida.
interface EyeDropperCtor { new (): { open: () => Promise<{ sRGBHex: string }> } }
const nativeEyeDropper = (): EyeDropperCtor | null =>
  (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null

/**
 * Gotero al lado de la muestra de color, como en Illustrator: en vez de cambiar
 * de herramienta, perder lo que estabas haciendo y volver, tomás el color ahí
 * mismo y seguís.
 *
 * Donde el navegador no lo soporta cae en la herramienta gotero de siempre, que
 * hace lo mismo pero solo sobre el lienzo.
 */
function PickColorBtn({ onPick, onFallback, title }: {
  onPick: (hex: string) => void
  onFallback: () => void
  title: string
}) {
  return (
    <button
      title={title}
      onClick={async () => {
        const Ctor = nativeEyeDropper()
        if (!Ctor) { onFallback(); return }
        try {
          const { sRGBHex } = await new Ctor().open()
          if (sRGBHex) onPick(sRGBHex)
        } catch { /* el usuario cancelo con Escape */ }
      }}
      style={{
        display: 'grid', placeItems: 'center', width: 26, height: 26,
        borderRadius: 6, cursor: 'pointer', flexShrink: 0,
        background: 'none', border: '1px solid var(--line)', color: 'var(--fg-2)',
        transition: 'all 0.15s var(--ease)',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'var(--line)' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" />
        <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
      </svg>
    </button>
  )
}
const GARMENT_NAMES: Record<string, string> = { tshirt: 'Remera', chomba: 'Chomba', pants: 'Pantalón' }

// Cuánto mide en la realidad, a lo ancho, TODO lo que muestra el mockup.
// La chomba son ~105 porque el archivo trae dos prendas (frente y espalda) una
// al lado de la otra; el pantalón son ~42, que es lo que mide plancheado.
// Es lo que fija el tamaño del estampado hasta que estas prendas tengan medidas
// propias como la remera.
const ANCHO_NOMINAL_CM: Record<string, number> = { chomba: 105, pants: 42 }

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
      ;(circle as any)._rawTemp = true
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
      ;(circle as any)._rawTemp = true
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
      strokeLineCap: (old.strokeLineCap ?? 'round') as CanvasLineCap,
      fill: undefined, selectable: false, evented: true, clipPath: clip ?? undefined,
    })
  } else {
    const d = hasSmooth ? catmullRomToBezier(pts) : straightPathStr(pts)
    newObj = new fabric.Path(d, {
      stroke: old.stroke as string, strokeWidth: old.strokeWidth,
      strokeLineCap: (old.strokeLineCap ?? 'round') as CanvasLineCap,
      strokeLineJoin: (old.strokeLineJoin ?? 'round') as CanvasLineJoin,
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
      for (const [, scp1, scp2, sp1] of segs)
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

export default function EditorScreen({ project, onSave, onSaveComplete, onActionsReady, onOpenTechPack, onToast }: Props) {
  const canvasEl      = useRef<HTMLCanvasElement>(null)
  const canvasAreaRef = useRef<HTMLElement>(null)
  const cursorRef     = useRef<HTMLDivElement>(null)
  const fontFileRef   = useRef<HTMLInputElement>(null)
  const texFileRef    = useRef<HTMLInputElement>(null)
  const userTexImages = useRef<Map<string, HTMLImageElement>>(new Map())
  const fc            = useRef<fabric.Canvas | null>(null)
  const mockupObjects = useRef<fabric.FabricObject[]>([])
  const clipPath      = useRef<fabric.Group | null>(null)
  const undoHistory   = useRef<HistoryEntry[]>([])
  const redoHistory   = useRef<HistoryEntry[]>([])
  const clipboardBuf  = useRef<fabric.FabricObject | null>(null)
  // Por defecto se dibuja en negro y fino: es lo que se espera de una ficha
  // tecnica, que es linea sobre la prenda y no ilustracion.
  const colorRef      = useRef('#000000')
  const brushSizeRef  = useRef(1)
  const strokeStyleRef = useRef<StrokeStyle>('normal')
  const fillRef       = useRef<string | null>(null)
  const fontFamilyRef = useRef('Arial')
  const isMouseDown   = useRef(false)
  const snapPoints    = useRef<fabric.Point[]>([])
  // Borrador en curso de la pluma (trazo que todavia se esta dibujando): permite
  // que Ctrl+Z borre el ULTIMO punto puesto, en vez de deshacer lo ya guardado.
  const penDraftRef   = useRef<{ hasDraft: () => boolean; cancel: () => void; undoPoint: () => void } | null>(null)
  const clipEnabledRef = useRef(true)
  // false desde que el lienzo se destruye: al cerrar el editor, la limpieza de la
  // herramienta corre DESPUES del dispose() y no puede seguir tocandolo.
  const canvasAlive   = useRef(true)
  // Cuando se movio por ultima vez con las flechas, para agrupar la rafaga en
  // un solo paso de deshacer.
  const ultimaFlecha = useRef(0)
  const mockupLockedRef = useRef(true)
  const measuresRef = useRef<Measures>(DEFAULT_MEASURES)
  const pxPerCmRef = useRef(0)
  const teeFitRef = useRef<{ sc: number; ox: number; oy: number } | null>(null)
  // Nombres de las piezas antes de rehacer la prenda, para reponer la pintura
  // donde corresponde aunque cambie la cantidad de piezas.
  const mockupPrevKeys = useRef<string[]>([])
  // Los cortes con los que se partio la prenda, en coordenadas del DIBUJO
  // (no del lienzo), asi se estiran junto con la prenda al cambiar medidas.
  /**
   * Un corte de la prenda.
   *
   * `piezas` guarda el alcance que eligio el disenador: las piezas que el corte
   * parte. Se fija al dividir y no cambia despues, asi cambiar una medida no
   * hace que el corte se meta en una pieza que el disenador no eligio.
   */
  type Corte = { pts: Punto[]; piezas?: string[] }
  const cortesRef = useRef<Corte[]>([])
  const [hayCortes, setHayCortes] = useState(false)  // escala fija: el tamaño refleja los cm
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
  const [activeEffect,  setActiveEffect]  = useState<EffectKind | null>(null)
  // Las telas de fábrica y las del usuario viven en la MISMA lista: así el
  // aplicar, la escala real, los efectos y el guardado son un solo camino y no
  // dos parecidos. Se distinguen por el prefijo 'raw:' del id.
  const [userTextures,  setUserTextures]  = useState<UserTexture[]>(() => {
    const saved = loadRawWidths()
    return RAW_TEXTURES.map(t => ({
      id: t.id, name: t.name, dataUrl: t.url,
      widthCm: saved[t.id] ?? t.widthCm,
      createdAt: 0, builtIn: true,
    }))
  })
  const [activeUserTex, setActiveUserTex] = useState<string | null>(null)

  // Recoloreo de las telas de fábrica.
  // Los colores elegidos viven en un ref y no en estado porque los lee código
  // asíncrono (bajar el SVG, reteñir la foto): con estado quedaría leyendo el
  // valor viejo. paletteVersion es lo único que existe para redibujar la UI.
  const rawPalettes = useRef<Record<string, string[]>>(loadRawPalettes())
  const rawSource   = useRef(new Map<string, { text?: string; colors: string[] }>())
  const rawPhotos   = useRef(new Map<string, HTMLImageElement>())
  const [paletteVersion, setPaletteVersion] = useState(0)
  const [texImporting,  setTexImporting]  = useState(false)
  const [texError,      setTexError]      = useState<string | null>(null)
  const [effectIntensity, setEffectIntensity] = useState(0.6)
  const [texAdvanced, setTexAdvanced] = useState(false)  // editor por-slot (avanzado) colapsado
  const [layers,       setLayers]       = useState<fabric.FabricObject[]>([])
  const [selectedObj,  setSelectedObj]  = useState<fabric.FabricObject | null>(null)

  const [hasSel,        setHasSel]        = useState(false)
  const [isText,        setIsText]        = useState(false)
  const [polySides,     setPolySides]     = useState(6)   // lados del polígono
  const [starPointCount, setStarPointCount] = useState(5) // puntas de la estrella
  const polySidesRef    = useRef(6)
  const starPointsRef   = useRef(5)
  // Símbolos (sellos): se guardan serializados y se estampan con la herramienta Símbolo.
  const [symbols, setSymbols] = useState<{ id: string; name: string; json: any }[]>(() => {
    try { return JSON.parse(localStorage.getItem('raw.symbols') || '[]') } catch { return [] }
  })
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null)
  const symbolsRef      = useRef<{ id: string; name: string; json: any }[]>([])
  const activeSymbolRef = useRef<string | null>(null)
  // Diálogo de medidas exactas: aparece al hacer click (sin arrastrar) con una forma.
  const [exactDialog, setExactDialog] = useState<{ sx: number; sy: number; px: number; py: number; tool: Tool } | null>(null)
  const [exactW, setExactW] = useState(100)
  const [exactH, setExactH] = useState(100)
  const [propFill,      setPropFill]      = useState<string | null>(null)
  const [propStroke,    setPropStroke]    = useState('#000000')
  const [propSWidth,    setPropSWidth]    = useState(1)
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
  const [ctxMenu,        setCtxMenu]        = useState<null | { x: number; y: number; target: fabric.FabricObject | null; escena?: fabric.Point; isGroup: boolean; isMulti: boolean }>(null)
  const [mockupLocked,   setMockupLocked]   = useState(true)
  const [dragActive,     setDragActive]     = useState(false)
  // Muestra que sigue al cursor mientras se arrastra con el gotero, para ver el
  // color sin tener que mirar al panel de la derecha.
  const [eyeProbe,       setEyeProbe]       = useState<null | { x: number; y: number; hex: string }>(null)
  // Bordado: hacia dónde corren las puntadas y si está trabajando.
  // La lupa se dibuja a mano en cada movimiento del mouse: si sus píxeles
  // pasaran por el estado de React, repintaría el panel entero a 60 por segundo.
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const [bordadoAngulo,  setBordadoAngulo]  = useState(70)
  const [bordando,       setBordando]       = useState(false)
  const [measures,       setMeasures]       = useState<Measures>(DEFAULT_MEASURES)
  // Medidas de las OTRAS prendas paramétricas (pantalón y chomba). Van aparte de
  // las de la remera porque cada prenda tiene sus propias medidas: un pantalón
  // no tiene ancho de cuello y una remera no tiene ruedo.
  const prendaParam = PRENDAS_PARAM[project.mockupId]
  const [medidas,        setMedidas]        = useState<Medidas>(() => ({ ...(prendaParam?.defaults ?? {}) }))
  const medidasRef  = useRef<Medidas>(medidas)
  const piezasRef   = useRef<PiezaSvg[]>([])            // el dibujo original, sin deformar
  const prendaFitRef = useRef<{ sc: number; ox: number; oy: number } | null>(null)
  // Separación original entre frente y espalda (chomba), medida una sola vez.
  const huecoMitadesRef = useRef<number | null>(null)
  useEffect(() => { medidasRef.current = medidas }, [medidas])
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
  useEffect(() => { polySidesRef.current  = polySides     }, [polySides])
  useEffect(() => { starPointsRef.current = starPointCount }, [starPointCount])
  useEffect(() => { symbolsRef.current      = symbols      }, [symbols])
  useEffect(() => { activeSymbolRef.current = activeSymbol }, [activeSymbol])
  useEffect(() => { fontFamilyRef.current = propFontFamily }, [propFontFamily])
  useEffect(() => { restoreUserFonts().then(names => { if (names.length) setUserFonts(names) }) }, [])

  // Precarga la imagen de una textura. recomposeFill es síncrono y necesita el
  // <img> ya decodificado, así que hasta que no carga la pieza queda como está.
  function preloadTexImage(id: string, src: string) {
    if (userTexImages.current.has(id)) return
    const img = new Image()
    img.onload = () => {
      userTexImages.current.set(id, img)
      // Si el diseño guardado ya usaba esta textura, redibujarla ahora.
      const c = fc.current
      if (!c) return
      let touched = false
      c.getObjects().forEach(o => {
        if ((o as any)._userTex?.id === id) { recomposeFill(o); touched = true }
      })
      if (touched) c.requestRenderAll()
    }
    img.src = src
  }

  // Biblioteca de texturas: las del usuario salen de IndexedDB y se suman a las
  // de fábrica, que ya están en la lista desde el arranque.
  useEffect(() => {
    let cancelled = false
    listUserTextures().then(list => {
      if (cancelled) return
      setUserTextures(prev => [...prev.filter(t => t.builtIn), ...list])
      list.forEach(t => preloadTexImage(t.id, t.dataUrl))
    })
    return () => { cancelled = true }
  }, [])

  // ── Recoloreo de las telas de fábrica ──────────────────────────────────────
  // Lee del archivo los colores que la tela trae de origen. De un SVG salen sus
  // rellenos, ordenados por cuánta tela ocupa cada uno; de una foto sale un solo
  // color, el dominante, porque una foto no tiene colores separables.
  async function rawSourceOf(def: { id: string; url: string; kind: 'svg' | 'photo' }) {
    const cached = rawSource.current.get(def.id)
    if (cached) return cached

    let src: { text?: string; colors: string[] }
    if (def.kind === 'svg') {
      const text = await fetch(def.url).then(r => r.text())
      const found = readSvgColors(text).slice(0, 12)
      src = { text, colors: await sortColorsByArea(def.url, found) }
    } else {
      const img = await loadImage(def.url)
      rawPhotos.current.set(def.id, img)      // el original, para poder reteñir siempre desde él
      src = { colors: [dominantColor(img)] }
    }
    rawSource.current.set(def.id, src)
    return src
  }

  // Deja en userTexImages la imagen de esa tela con los colores elegidos.
  // Sin colores elegidos usa el archivo tal cual, que es más rápido y no pierde
  // nada de calidad.
  async function ensureRawImage(id: string): Promise<boolean> {
    const def = rawTextureById(id)
    if (!def) return false
    try {
      const src = await rawSourceOf(def)
      const chosen = rawPalettes.current[id]
      const original = !chosen || sameColors(chosen, src.colors)

      let img: HTMLImageElement
      if (original) {
        img = await loadImage(def.url)
      } else if (def.kind === 'svg') {
        img = await loadImage(svgToDataUrl(recolorSvg(src.text!, src.colors, chosen)))
      } else {
        const base = rawPhotos.current.get(id) ?? await loadImage(def.url)
        img = await loadImage(tintImage(base, src.colors[0], chosen[0]).toDataURL('image/png'))
      }
      userTexImages.current.set(id, img)
      return true
    } catch {
      return false
    }
  }

  // Cambia la paleta de una tela de fábrica y repinta todas las piezas que la usen.
  function setRawPalette(id: string, colors: string[] | null) {
    if (colors) rawPalettes.current[id] = colors
    else delete rawPalettes.current[id]
    saveRawPalette(id, colors)
    setPaletteVersion(v => v + 1)

    ensureRawImage(id).then(ok => {
      if (!ok) return
      setPaletteVersion(v => v + 1)     // la miniatura sale de la imagen ya recoloreada
      const c = fc.current
      if (!c) return
      c.getObjects().forEach(o => {
        if ((o as any)._userTex?.id === id) recomposeFill(o)
      })
      markDirty()
      c.requestRenderAll()
    })
  }

  // Le devuelve a la prenda la tela y el color con los que se guardó.
  // Se empareja por índice, igual que al cambiar una medida: las piezas siempre
  // se construyen en el mismo orden. Si los números no coinciden es que la
  // prenda cambió de forma desde que se guardó, y ahí es mejor no adivinar y
  // dejarla limpia que pintarle la manga con el color del cuerpo.
  function restoreGarmentPaint(garment: SavedGarment | null | undefined) {
    const pieces = garment?.pieces
    const objs = mockupObjects.current
    if (!pieces || !pieces.length) return

    // Se busca por NOMBRE de pieza. Antes era por posicion, y con eso el dia que
    // cambia la cantidad de piezas el color cae en la pieza equivocada -o no
    // cae en ninguna, porque la funcion se cortaba entera.
    const porNombre = new Map<string, SavedPiece>()
    for (const p of pieces) if (p?.key) porNombre.set(p.key, p)

    // Proyectos guardados antes de partir la remera: tenian UNA sola pieza de
    // cuerpo, y ese color cubria tambien las mangas. Se reparte a las tres.
    const formatoViejo = porNombre.size === 0
    const pintuaViejaDelCuerpo = formatoViejo ? pieces[0] : undefined

    objs.forEach((o, i) => {
      if ((o as any)._rawInner) return          // el hueco del cuello no se pinta
      const clave = (o as any)._pieceKey as string | undefined
      const esCuerpoOManga = clave === 'cuerpo' || clave === 'manga-izq' || clave === 'manga-der'
      const p = formatoViejo
        ? (esCuerpoOManga ? pintuaViejaDelCuerpo : pieces[i])
        : (clave ? porNombre.get(clave) : pieces[i])
      if (!p) return
      if (p.tex)  (o as any)._texture   = p.tex
      if (p.eff)  (o as any)._effect    = p.eff
      if (p.uTex) (o as any)._userTex   = p.uTex
      // Misma regla que al regenerar la prenda: sin tela, el color liso que quedo
      // dibujado es la base, aunque venga una base vieja desincronizada.
      const colorLiso = !p.tex && !p.uTex && typeof p.fill === 'string' && p.fill !== ''
      if (colorLiso)   (o as any)._baseColor = p.fill
      else if (p.base) (o as any)._baseColor = p.base
      if ((o as any)._baseColor || p.tex || p.eff || p.uTex) recomposeFill(o)
      else if (p.fill) o.set({ fill: p.fill })
    })
    syncInnerShade()
  }

  // Baja las telas de fábrica que un diseño ya guardado esté usando. No se
  // precargan todas al abrir el editor: son varios MB y casi siempre no se usa
  // ninguna. Al terminar de cargar, preloadTexImage rehace el relleno solo.
  function preloadRawTexturesUsedBy(objs: fabric.FabricObject[]) {
    const ids = new Set<string>()
    objs.forEach(o => {
      const u = (o as any)._userTex as { id: string } | undefined
      if (u && isRawTexture(u.id) && !userTexImages.current.has(u.id)) ids.add(u.id)
    })
    ids.forEach(id => ensureRawImage(id).then(ok => {
      const c = fc.current
      if (!ok || !c) return
      let touched = false
      c.getObjects().forEach(o => {
        if ((o as any)._userTex?.id === id) { recomposeFill(o); touched = true }
      })
      if (touched) c.requestRenderAll()
    }))
  }

  // Al elegir una tela de fábrica hay que leerle los colores del archivo para
  // poder mostrar la paleta. Se hace una sola vez por tela y queda cacheado.
  useEffect(() => {
    if (!activeUserTex || !isRawTexture(activeUserTex)) return
    if (rawSource.current.has(activeUserTex)) return
    const def = rawTextureById(activeUserTex)
    if (def) rawSourceOf(def).then(() => setPaletteVersion(v => v + 1))
  }, [activeUserTex])

  async function handleTextureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''            // permite volver a elegir el mismo archivo
    if (!file) return
    setTexImporting(true); setTexError(null)
    try {
      const t = await importUserTexture(file)
      const img = new Image()
      img.onload = () => { userTexImages.current.set(t.id, img); applyUserTexture(t) }
      img.src = t.dataUrl
      setUserTextures(prev => [t, ...prev])
    } catch (err) {
      setTexError(err instanceof Error ? err.message : 'No se pudo importar')
    } finally {
      setTexImporting(false)
    }
  }

  async function handleTextureDelete(id: string) {
    if (isRawTexture(id)) return      // las telas de fábrica no se borran
    await deleteUserTexture(id)
    userTexImages.current.delete(id)
    setUserTextures(prev => prev.filter(t => t.id !== id))
    if (activeUserTex === id) setActiveUserTex(null)
  }

  // Register save/export actions for ChromeBar
  useEffect(() => {
    const handleSaveRef = () => handleSave()
    const handleExportRef = () => handleExport()
    onActionsReady({ save: handleSaveRef, export: handleExportRef, importImage: handleImportPng, placeImage: handlePlaceImage, techpack: openTechPack })
    return () => onActionsReady(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Deja listas las tipografías que usa un diseño y devuelve las que no están.
   *
   * Las de Google se bajan; las propias del diseñador viven en ESTE navegador
   * (no viajan con el proyecto), así que en otro dispositivo no van a estar y
   * hay que decirlo en vez de cambiar la fuente en silencio.
   */
  async function cargarFuentesDelDiseno(objs: fabric.FabricObject[]): Promise<string[]> {
    const familias = new Set<string>()
    for (const o of objs) {
      const f = (o as any).fontFamily
      if (typeof f === 'string' && f) familias.add(f)
    }
    if (!familias.size) return []
    const propias = await restoreUserFonts().catch(() => [] as string[])
    if (propias.length) setUserFonts(propias)
    const faltan: string[] = []
    for (const f of familias) {
      if ((GOOGLE_FONTS as readonly string[]).includes(f)) { await loadGoogleFont(f); continue }
      if ((SYSTEM_FONTS as readonly string[]).includes(f)) continue
      if (propias.includes(f)) continue
      faltan.push(f)
    }
    return faltan
  }

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
    // Modificadores al escalar, como en Illustrator:
    //  - Shift = mantener la proporción (no se deforma).
    //  - Alt   = escalar desde el centro (los dos lados crecen a la vez).
    //
    // Estaban al revés. Shift para mantener proporción es el gesto que tiene
    // aprendido cualquiera que use un editor gráfico, así que invertirlo se
    // siente como que la tecla no anda.
    ;(canvas as any).uniScaleKey = 'shiftKey'
    ;(canvas as any).centeredKey = 'altKey'
    canvas.skipOffscreen = false

    // Lo guardado se lee ANTES de construir la prenda: las medidas tienen que
    // estar puestas cuando se dibuja, o saldría con el talle por defecto y
    // después habría que rehacerla entera.
    autosaveListo.current = false
    const design = project.canvasJson ? parseDesign(project.canvasJson) : null
    if (design?.garment?.measures) {
      const m = { ...DEFAULT_MEASURES, ...design.garment.measures }
      measuresRef.current = m
      setMeasures(m)
    }
    // Ídem para el pantalón y la chomba. Se parte de los valores por defecto de
    // ESTA prenda, así un proyecto viejo (guardado sin medidas) abre entero en
    // vez de con medidas en blanco.
    if (prendaParam) {
      const md: Medidas = { ...prendaParam.defaults, ...convertirMedidas(design?.garment, prendaParam) }
      medidasRef.current = md
      setMedidas(md)
    }
    // Los cortes van ANTES de construir la prenda: si se pusieran despues,
    // la prenda se armaria entera y habria que rehacerla.
    const cortesGuardados = design?.garment?.cortes
    cortesRef.current = Array.isArray(cortesGuardados)
      // Los primeros proyectos guardaban solo los puntos: esos valen para toda
      // la prenda, que era lo unico que se podia hacer.
      ? (cortesGuardados as unknown[]).map(c =>
          Array.isArray(c) ? { pts: c as Punto[] } : (c as Corte)
        ).filter(c => c?.pts?.length)
      : []
    setHayCortes(cortesRef.current.length > 0)

    // Restaura objetos del usuario guardados y conecta path:created (común a ambos mockups)
    const restoreAndWire = async () => {
      if (design) {
        // Se revive UNO POR UNO a propósito. enlivenObjects falla entero si un
        // solo objeto falla —por ejemplo una imagen cuyos datos quedaron rotos—,
        // y el catch de afuera se tragaba el error: el proyecto abría sin NADA
        // de lo dibujado, aunque la miniatura sí lo mostrara. Ahora un objeto
        // roto se pierde solo él.
        const revived: fabric.FabricObject[] = []
        let fallados = 0
        for (const raw of design.objects) {
          try {
            const [obj] = await (fabric.util as any).enlivenObjects([raw]) as fabric.FabricObject[]
            if (cancelled) return
            if (obj) revived.push(obj)
          } catch (e) {
            fallados++
            console.warn('no se pudo restaurar un objeto del diseño', e)
          }
        }
        if (cancelled) return
        // El recorte se recalcula ANTES de repartirlo. Es un grupo posicionado
        // en absoluto y, si todavía no tiene sus coordenadas hechas, recorta
        // contra un área vacía: el objeto entra al lienzo pero se dibuja en la
        // nada. Ese era el trazo que "aparecía recién al tocar una herramienta",
        // porque tocar una herramienta le cambia propiedades y lo obliga a
        // redibujarse, ya con el recorte bien calculado.
        clipPath.current?.setCoords()
        for (const obj of revived) {
          obj.set({ strokeUniform: true })
          if (!(obj instanceof fabric.IText) && clipPath.current) obj.set({ clipPath: clipPath.current })
          canvas.add(obj)
          obj.setCoords()
          obj.dirty = true          // tira el dibujo cacheado y lo rehace
        }
        if (fallados > 0) {
          onToast?.(`No se pudieron recuperar ${fallados} elemento${fallados > 1 ? 's' : ''} del diseño`)
        }
        restoreGarmentPaint(design.garment)
        preloadRawTexturesUsedBy([...revived, ...mockupObjects.current])

        // Las tipografías del diseño hay que CARGARLAS al abrirlo.
        //
        // Antes solo se cargaban al elegirlas del menú, así que al abrir un
        // diseño ya hecho —y sobre todo en otro dispositivo, que nunca las
        // pidió— el texto se dibujaba con la fuente de reemplazo del navegador.
        // El diseño estaba bien guardado; se veía mal.
        const faltantes = await cargarFuentesDelDiseno(revived)
        if (cancelled) return
        // Ya con la fuente de verdad, el texto se vuelve a medir y a dibujar.
        for (const o of revived) if (o instanceof fabric.IText) { o.initDimensions?.(); o.dirty = true }
        canvas.requestRenderAll()
        if (faltantes.length) {
          onToast?.(
            `No están en este dispositivo: ${faltantes.join(', ')}. ` +
            'Son tipografías propias y viven en la computadora donde las importaste.',
          )
        }
      }
      canvas.on('path:created', (e: { path: fabric.Path }) => {
        if (clipPath.current) e.path.clipPath = clipPath.current
        e.path.set({ selectable: false, evented: false })
        undoHistory.current.push({ type: 'add', obj: e.path })
        redoHistory.current = []
        canvas.renderAll()
      })

      // Desde acá en adelante, cualquier cambio dispara el guardado automático.
      // Antes no: agregar la prenda y restaurar lo guardado también son cambios,
      // y guardarlos apenas se abre el proyecto sería guardar lo mismo que se
      // acaba de leer.
      // Lo temporal no cuenta como cambio del diseno: los previews de la pluma se
      // agregan y se sacan en cada movimiento del mouse, y marcaban sucio decenas
      // de veces por segundo para terminar guardando siempre lo mismo.
      const markDirtyReal = (e: any) => { if (!(e?.target as any)?._rawTemp) markDirty() }
      canvas.on('object:added',    markDirtyReal)
      canvas.on('object:removed',  markDirtyReal)
      canvas.on('object:modified', markDirtyReal)
      autosaveListo.current = true

      canvas.renderAll()

      // Repintado forzado en el cuadro siguiente.
      //
      // Es, exactamente, lo que hacía tocar una herramienta: marcar todo para
      // redibujar y volver a pintar. Ese era el truco que el diseñador
      // encontró para que su trazo apareciera, y acá se hace solo.
      //
      // Va en el cuadro siguiente a propósito: recién ahí el lienzo tiene su
      // tamaño definitivo y el recorte de la prenda sus coordenadas hechas.
      // Pintar antes es pintar contra medidas que todavía no existen.
      requestAnimationFrame(() => {
        if (cancelled) return
        clipPath.current?.setCoords()
        canvas.getObjects().forEach(o => { o.setCoords(); o.dirty = true })
        canvas.requestRenderAll()
      })
    }

    if (PARAMETRIC_TEE && project.mockupId === 'tshirt') {
      // Remera paramétrica generada por medidas
      placeTee(measuresRef.current)
      restoreAndWire()
    } else if (prendaParam) {
      // Pantalón y chomba: también por medidas. Se lee el dibujo una vez y a
      // partir de ahí la prenda se rehace moviendo sus puntos.
      leerPiezasSvg(prendaParam.svg).then(async piezas => {
        if (cancelled) return
        piezasRef.current = piezas
        placePrenda(medidasRef.current)
        await restoreAndWire()
      })
    } else {
      // Mockups SVG (chomba, pants)
      const svgUrl = `/mockups/${project.mockupId}.svg`
      fabric.loadSVGFromURL(svgUrl).then(async ({ objects }) => {
        if (cancelled) return
        const objs = objects.filter(Boolean) as fabric.FabricObject[]
        mockupObjects.current = objs
        objs.forEach((obj, i) => {
          const id = String((obj as any).id ?? '')
          ;(obj as any)._rawMockup = true
          ;(obj as any)._pieceName = pieceLabelFromId(id, `Pieza ${i + 1}`)
          // Misma regla que en la remera: lo que es un agujero de la prenda (el
          // escote de la chomba) muestra el otro lado y no lleva estampado.
          const esInterior = id.startsWith('inner-')
          if (esInterior)          (obj as any)._rawInner = true
          if (id.startsWith('body')) (obj as any)._rawBody = true
          obj.set({ selectable: false, evented: !esInterior, hoverCursor: 'crosshair' })
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
        // Estas prendas aun no son parametricas (no tienen medidas en cm), asi
        // que la escala de las texturas se estima con un ancho nominal.
        // El nominal es de TODO lo que se ve, no de una prenda: el archivo de la
        // chomba trae frente y espalda una al lado de la otra, y medirlo como si
        // fuera una sola prenda dejaba el estampado a mitad de tamaño.
        // Sera exacto cuando chomba y pantalon tengan medidas propias.
        pxPerCmRef.current = (bw * sc) / (ANCHO_NOMINAL_CM[project.mockupId] ?? 60)
        const ox  = (CW - bw * sc) / 2 - bx * sc
        const oy  = (CH - bh * sc) / 2 - by * sc
        objs.forEach(obj => {
          obj.set({
            left: (obj.left ?? 0) * sc + ox, top: (obj.top ?? 0) * sc + oy,
            scaleX: (obj.scaleX ?? 1) * sc, scaleY: (obj.scaleY ?? 1) * sc,
          })
          obj.setCoords()  // recalcula oCoords → el hit-test (click) ubica cada pieza
        })
        syncInnerShade()

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

    return () => { cancelled = true; canvasAlive.current = false; ro?.disconnect(); canvas.off('after:render', onAfterRender); canvas.off('mouse:over', onMouseOver); canvas.off('mouse:out', onMouseOut); canvas.dispose() }
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
        evented:    tool === 'select' || tool === 'curve' || tool === 'pen' || tool === 'fill'
                 || tool === 'eyedropper' || (tool === 'text' && isIText),
        selectable: tool === 'select',
        hoverCursor: tool === 'fill' ? 'pointer' : drawnHoverCursor,
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
        ;(previewPath as any)._rawTemp = true
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
        // El cierre no es un trazo: es un pincel que estampa, y entra como imagen.
        if (strokeStyleRef.current === 'cierre') {
          const z = dibujarCierre(simplified, brushSizeRef.current, colorRef.current)
          if (z) {
            const img = new fabric.FabricImage(z.el, {
              left: z.left, top: z.top,
              scaleX: 1 / z.sup, scaleY: 1 / z.sup,
              selectable: false, evented: false,
            })
            if (clipPath.current) img.clipPath = clipPath.current
            canvas.add(img)
            undoHistory.current.push({ type: 'add', obj: img })
            redoHistory.current = []
          }
          rawPts = []
          canvas.requestRenderAll()
          return
        }
        const special = specialStrokeData(simplified, strokeStyleRef.current, brushSizeRef.current)
        const obj = special
          ? new fabric.Path(special.d, {
              stroke: colorRef.current, strokeWidth: special.sw,
              strokeLineCap: 'round',
              fill: special.relleno ? colorRef.current : null,
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
      // El trazo en curso vive en el lienzo como un objeto REAL, no como preview.
      // Asi lo que ya clickeaste existe (y entra en el guardado) sin tener que
      // confirmarlo con Enter.
      let liveObj: fabric.Path | null = null
      let mouseIsDown    = false
      let draggingHandle = false
      let cursorPt       = new fabric.Point(0, 0)
      let isClosing      = false
      let lastClickTime  = 0
      let lastClickPos: fabric.Point | null = null
      const SNAP_RADIUS  = 14
      const ALIGN_THRESH = 8

      /**
       * El eje vertical por el centro de la prenda.
       *
       * Es el eje de simetría natural de una prenda: lo que está a un lado del
       * cuello tiene que estar igual del otro. Se calcula en coordenadas del
       * lienzo (no de la pantalla) para que no dependa del zoom.
       */
      const ejeSimetria = (): number | null => {
        const objs = mockupObjects.current.filter(o => o.visible !== false)
        if (!objs.length) return null
        let x1 = Infinity, x2 = -Infinity
        for (const o of objs) {
          const l = o.left ?? 0
          const w = (o.width ?? 0) * Math.abs(o.scaleX ?? 1)
          x1 = Math.min(x1, l); x2 = Math.max(x2, l + w)
        }
        return Number.isFinite(x1) ? (x1 + x2) / 2 : null
      }

      /** El reflejo de cada punto del otro lado del eje. */
      const reflejar = (pts: fabric.Point[], eje: number) =>
        pts.map(p => new fabric.Point(2 * eje - p.x, p.y))

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

        // Imantado al ESPEJO de lo ya dibujado.
        //
        // Sin esto no se puede hacer una figura simétrica: el imán enganchaba a
        // los puntos propios en horizontal y vertical, pero nunca al reflejo del
        // otro lado, que es justo lo que hace falta para que el lado derecho
        // copie al izquierdo. Ahora, al dibujar la segunda mitad, cada punto cae
        // exacto en el reflejo del que le corresponde, y se muestra el eje.
        const eje = ejeSimetria()
        if (eje != null) {
          const propios = candidates.filter(p => anchors.some(a => a.pt === p))
          for (const espejo of reflejar(propios.length ? propios : candidates, eje)) {
            if (Math.hypot(raw.x - espejo.x, raw.y - espejo.y) < SNAP_RADIUS) {
              return {
                snapped: new fabric.Point(espejo.x, espejo.y),
                nodeSnap: espejo,
                guides: [{ axis: 'v', val: eje }],   // se ve por qué enganchó
              }
            }
          }
        }
        let sx = raw.x, sy = raw.y
        const guides: Array<{ axis: 'h' | 'v'; val: number }> = []
        // Include midpoints of all pairs so e.g. the apex of an equilateral triangle
        // snaps to the center X of the base automatically.
        const alignPts: Array<{ x: number; y: number }> = [...candidates]
        for (let i = 0; i < candidates.length; i++)
          for (let j = i + 1; j < candidates.length; j++)
            alignPts.push({ x: (candidates[i].x + candidates[j].x) / 2, y: (candidates[i].y + candidates[j].y) / 2 })
        // El eje de la prenda también imanta: es donde hay que apoyar el punto
        // de arriba y el de abajo de una figura simétrica (la punta y la base).
        if (eje != null) alignPts.push({ x: eje, y: raw.y })
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
      const addTemp   = (o: fabric.FabricObject) => { (o as any)._rawTemp = true; tempObjs.push(o); canvas.add(o) }

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
      // Conservado a proposito: suavizado automatico de esquinas, listo para usar.
      void autoSmoothCorners

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

      // Saca del lienzo el objeto del trazo en curso (si lo hay).
      const dropLive = () => {
        if (!liveObj) return
        canvas.remove(liveObj)
        liveObj = null
      }

      // Rehace el objeto del trazo en curso con los anclas puestas hasta ahora.
      // Se dibuja siempre como trazo normal: los estilos especiales (bordado,
      // cierre) se calculan una sola vez al confirmar, que es cuando importan.
      const syncLive = () => {
        dropLive()
        if (anchors.length < 2) return
        const d = buildPenPath(anchors)
        const obj = new fabric.Path(d, {
          stroke: colorRef.current, strokeWidth: brushSizeRef.current,
          strokeLineCap: d.includes(' C ') ? 'round' : 'butt',
          strokeLineJoin: 'round',
          fill: fillRef.current, selectable: false, evented: false,
          strokeUniform: true,
        })
        ;(obj as any).hoverCursor = PEN_CURSOR
        if (clipPath.current) obj.clipPath = clipPath.current
        canvas.add(obj)
        liveObj = obj
      }

      const commit = (closed = false) => {
        clearTemp()
        dropLive()
        if (anchors.length >= 2) {
          snapPoints.current.push(new fabric.Point(anchors[0].pt.x, anchors[0].pt.y))
          const lastPt = anchors[anchors.length - 1].pt
          if (!closed) snapPoints.current.push(new fabric.Point(lastPt.x, lastPt.y))
          const penPathStr = buildPenPath(anchors, closed)
          // Trazado especial (bordado/cierre): muestreo la curva en puntos y la
          // reemplazo por las puntadas; si es normal, dejo el path tal cual.
          let special: { d: string; sw: number; relleno?: boolean } | null = null
          let cierreImg: fabric.FabricImage | null = null
          if (strokeStyleRef.current !== 'normal') {
            const sampled = samplePathCommands((new fabric.Path(penPathStr)).path as any[], Math.max(3, brushSizeRef.current * 0.5))
            if (strokeStyleRef.current === 'cierre') {
              const z = dibujarCierre(sampled, brushSizeRef.current, colorRef.current)
              if (z) cierreImg = new fabric.FabricImage(z.el, {
                left: z.left, top: z.top,
                scaleX: 1 / z.sup, scaleY: 1 / z.sup,
                selectable: false, evented: true,
              })
            } else {
              special = specialStrokeData(sampled, strokeStyleRef.current, brushSizeRef.current)
            }
          }
          const obj = cierreImg ? cierreImg : special
            ? new fabric.Path(special.d, {
                stroke: colorRef.current, strokeWidth: special.sw,
                strokeLineCap: 'round',
                fill: special.relleno ? colorRef.current : null,
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

      // Tira el trazo en curso entero. Lo usa Ctrl+Z cuando se va el ultimo punto
      // que quedaba, y el cambio de herramienta con un solo ancla puesta.
      const cancelDraft = () => {
        clearTemp(); clearEdit(); dropLive()
        anchors.length = 0
        mouseIsDown = false; draggingHandle = false; isClosing = false
        canvas.requestRenderAll()
      }
      // Ctrl+Z mientras dibujas: se va el ULTIMO punto puesto, no el trazo entero
      // ni lo ultimo que habias guardado antes de empezar. Repetirlo desarma el
      // trazo punto por punto hasta que no queda nada.
      const undoPoint = () => {
        if (anchors.length === 0) return
        anchors.pop()
        mouseIsDown = false; draggingHandle = false; isClosing = false
        if (anchors.length === 0) { cancelDraft(); return }
        syncLive()
        redraw(cursorPt)
      }

      penDraftRef.current = { hasDraft: () => anchors.length > 0, cancel: cancelDraft, undoPoint }

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
        syncLive()
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

      const onUp = () => {
        const wasDragging = draggingHandle
        mouseIsDown = false; draggingHandle = false
        if (wasDragging) syncLive()   // la curva quedo definida al soltar el handle
        redraw(cursorPt)
      }

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
        // Cambiar de herramienta con un trazo a medias lo confirma en vez de
        // tirarlo: lo dibujado es del disenador, no del estado interno de la
        // pluma. Si el lienzo ya se destruyo (cerraron el editor) no hay nada
        // que confirmar.
        if (canvasAlive.current) {
          if (anchors.length >= 2) commit()
          else cancelDraft()
        }
        clearTemp()
        clearEdit()
        hideSizeCursor()
        penDraftRef.current = null
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
                strokeLineCap:  (obj.strokeLineCap  ?? 'round') as CanvasLineCap,
                strokeLineJoin: (obj.strokeLineJoin ?? 'round') as CanvasLineJoin,
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
      // El balde deja la pieza en color liso: hay que BORRAR la tela que tuviera,
      // o al primer redibujo (cambiar una medida, guardar y abrir) el estampado
      // volvía por encima del color recién elegido.
      const pintar = (objs: fabric.FabricObject[]) => {
        const items = objs
          .filter(o => o && !(o as any)._locked)
          .map(o => ({ obj: o, prev: snapshotPaint(o) }))
        if (!items.length) return
        for (const it of items) {
          applyPaint(it.obj, { fill: colorRef.current, base: colorRef.current })
        }
        // El hueco del cuello se lee como el reves de la tela: si el cuerpo
        // cambia de color tiene que acompanar, aunque se pinte de a una pieza.
        syncInnerShade()
        undoHistory.current.push({ type: 'fillBatch', items })
        redoHistory.current = []
        canvas.requestRenderAll()
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        // Un clic pinta SOLO la pieza que se tocó: si es una prenda se pinta esa
        // pieza, y si es algo dibujado se pinta ese item y no la prenda de atrás.
        //
        // Ya NO se recalcula la sombra del escote. Antes se hacía siempre, y
        // pintar el pecho de la chomba te tenía el escote de rojo oscuro sin
        // haberlo tocado. Ahora el escote solo acompaña cuando se pinta la
        // prenda ENTERA (doble clic o desde el panel de telas).
        const target = e.target
        if (!target || (target as any)._locked) return
        pintar([target])
      }

      // Doble clic: toda la prenda de una. Ahí sí el escote acompaña, porque es
      // el interior de la misma prenda que se acaba de pintar.
      const onDouble = (e: fabric.TPointerEventInfo) => {
        const target = e.target
        if (!target) return
        const esPrenda = mockupObjects.current.includes(target)
        if (!esPrenda) return
        pintar(mockupObjects.current.filter(o => !(o as any)._rawInner))
        syncInnerShade()
        canvas.requestRenderAll()
      }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:dblclick', onDouble)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:dblclick', onDouble)
      })
    }

    // ── Gotero ───────────────────────────────────────────────────────────────
    if (tool === 'eyedropper') {
      canvas.selection     = false
      canvas.defaultCursor = EYEDROPPER_CURSOR

      // El gotero muestra el color ANTES de tomarlo.
      //
      // El problema no era tomar el color: era APUNTAR. Si le errabas al píxel
      // ya estaba, y había que volver a probar a ciegas. Ahora, con solo pasar
      // el mouse (sin apretar nada), aparece una lupa con los píxeles agrandados
      // y el color exacto del centro. Se apunta mirando, se hace clic y listo.
      //
      // Además se puede mantener apretado y arrastrar: el color se va aplicando
      // en vivo al objeto seleccionado y recién al soltar queda fijo.
      let scrubbing  = false
      let snapshot: ImageData | null = null   // el lienzo ANTES de la vista previa
      let snapScale  = 1
      let previewObj: fabric.FabricObject | null = null
      let prevProps: Record<string, any> | null = null
      let lastPatch: Record<string, any> | null = null

      const ctxLienzo = () => (canvas as any).contextContainer as CanvasRenderingContext2D | undefined
      const elLienzo  = () => (canvas as any).lowerCanvasEl as HTMLCanvasElement | undefined

      // En pantallas retina el lienzo tiene más píxeles reales que los que mide
      // en la página; sin esta escala se muestrea el color del lugar equivocado.
      const escala = () => {
        const el = elLienzo(), w = canvas.getWidth()
        return (el && w) ? el.width / w : 1
      }

      // Foto del lienzo al apretar. Sirve para que la vista previa no se muerda
      // la cola: al pasar por encima del objeto que estoy pintando leería el
      // color que le acabo de poner en vez del que había abajo.
      const grabSnapshot = () => {
        const ctx = ctxLienzo(), el = elLienzo()
        if (!ctx || !el) return false
        snapScale = escala()
        try { snapshot = ctx.getImageData(0, 0, el.width, el.height) } catch { return false }
        return true
      }

      /** El punto bajo el cursor, en píxeles reales del lienzo. */
      const puntoLienzo = (e: fabric.TPointerEventInfo): [number, number] => {
        const vpt = (canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0]) as number[]
        const p = e.scenePoint
        const k = scrubbing ? snapScale : escala()
        return [Math.round((vpt[0] * p.x + vpt[4]) * k), Math.round((vpt[3] * p.y + vpt[5]) * k)]
      }

      const aHexRgb = (r: number, g: number, b: number) =>
        '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

      // Qué hay bajo el puntero. Si es un objeto dibujado copio TODA su apariencia
      // (relleno + trazo + grosor), como el gotero de Illustrator; si no, el color
      // del píxel pintado (prenda, imagen, textura…).
      const sampleAt = (e: fabric.TPointerEventInfo): Record<string, any> | null => {
        const over = e.target
        if (over && over !== previewObj && !mockupObjects.current.includes(over)
            && typeof over.fill === 'string') {
          return { fill: over.fill, stroke: over.stroke, strokeWidth: over.strokeWidth }
        }
        const [px, py] = puntoLienzo(e)
        if (scrubbing) {
          if (!snapshot) return null
          if (px < 0 || py < 0 || px >= snapshot.width || py >= snapshot.height) return null
          const d = snapshot.data, i = (py * snapshot.width + px) * 4
          if (d[i + 3] < 10) return null
          return { fill: aHexRgb(d[i], d[i + 1], d[i + 2]) }
        }
        const ctx = ctxLienzo()
        if (!ctx) return null
        try {
          const d = ctx.getImageData(px, py, 1, 1).data
          if (d[3] < 10) return null
          return { fill: aHexRgb(d[0], d[1], d[2]) }
        } catch { return null }
      }

      /** Dibuja los píxeles de alrededor agrandados, con el del centro marcado. */
      const CELDAS = 11
      const pintarLupa = (e: fabric.TPointerEventInfo) => {
        const lc = loupeRef.current
        if (!lc) return
        const g = lc.getContext('2d')
        if (!g) return
        const [px, py] = puntoLienzo(e)
        const r = (CELDAS - 1) / 2
        let datos: ImageData | null = null
        if (scrubbing && snapshot) {
          // Se recorta del snapshot a mano: pedirle los píxeles al lienzo ya no
          // sirve, porque encima tiene la vista previa recién aplicada.
          datos = new ImageData(CELDAS, CELDAS)
          for (let fy = 0; fy < CELDAS; fy++) {
            for (let fx = 0; fx < CELDAS; fx++) {
              const sx = px - r + fx, sy = py - r + fy
              if (sx < 0 || sy < 0 || sx >= snapshot.width || sy >= snapshot.height) continue
              const o = (fy * CELDAS + fx) * 4, k = (sy * snapshot.width + sx) * 4
              datos.data[o]     = snapshot.data[k]
              datos.data[o + 1] = snapshot.data[k + 1]
              datos.data[o + 2] = snapshot.data[k + 2]
              datos.data[o + 3] = snapshot.data[k + 3]
            }
          }
        } else {
          const ctx = ctxLienzo()
          if (!ctx) return
          try { datos = ctx.getImageData(px - r, py - r, CELDAS, CELDAS) } catch { return }
        }
        if (!datos) return
        const chico = document.createElement('canvas')
        chico.width = CELDAS; chico.height = CELDAS
        chico.getContext('2d')!.putImageData(datos, 0, 0)
        g.imageSmoothingEnabled = false
        g.clearRect(0, 0, lc.width, lc.height)
        g.drawImage(chico, 0, 0, lc.width, lc.height)
        // El recuadro del centro marca EXACTAMENTE el píxel que se va a tomar.
        const z = lc.width / CELDAS
        g.lineWidth = 2
        g.strokeStyle = 'rgba(0,0,0,0.85)'
        g.strokeRect(r * z - 1, r * z - 1, z + 2, z + 2)
        g.lineWidth = 1
        g.strokeStyle = 'rgba(255,255,255,0.95)'
        g.strokeRect(r * z, r * z, z, z)
      }

      /** Mueve la muestra, dibuja la lupa y —si estoy arrastrando— aplica el color. */
      const preview = (e: fabric.TPointerEventInfo) => {
        const area = canvasAreaRef.current
        const ev   = e.e as MouseEvent
        if (area && ev && typeof ev.clientX === 'number') {
          const rc = area.getBoundingClientRect()
          setEyeProbe(prev => ({
            x: ev.clientX - rc.left, y: ev.clientY - rc.top,
            hex: prev?.hex ?? fillRef.current ?? '#000000',
          }))
        }
        pintarLupa(e)
        const patch = sampleAt(e)
        if (!patch) return
        const hex = patch.fill as string
        setEyeProbe(prev => prev && { ...prev, hex })
        if (!scrubbing) return          // solo mirando: todavía no se toma nada
        lastPatch = patch
        // El color tomado pasa a ser el RELLENO activo (default de Illustrator)
        fillRef.current = hex
        setPropFill(hex)
        if (previewObj) { previewObj.set(patch as any); canvas.requestRenderAll() }
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        if (!grabSnapshot()) return
        const active = canvas.getActiveObject()
        previewObj = active && !mockupObjects.current.includes(active) ? active : null
        prevProps  = previewObj
          ? { fill: previewObj.fill, stroke: previewObj.stroke, strokeWidth: previewObj.strokeWidth }
          : null
        scrubbing = true
        lastPatch = null
        preview(e)
      }

      const onMove = (e: fabric.TPointerEventInfo) => { preview(e) }

      const finish = () => {
        if (!scrubbing) return
        scrubbing = false
        snapshot  = null   // que no quede una copia del lienzo entero en memoria
        // El registro para deshacer se guarda recién acá: todo el arrastre es UNA
        // sola acción, no una por cada píxel que toqué en el camino.
        if (previewObj && prevProps && lastPatch) {
          const prev: Record<string, any> = {}
          for (const k of Object.keys(lastPatch)) prev[k] = prevProps[k]
          undoHistory.current.push({ type: 'props', obj: previewObj, prev })
          redoHistory.current = []
        }
        previewObj = null; prevProps = null; lastPatch = null
      }

      // La muestra se va cuando el mouse SALE del lienzo, no al soltar: el gotero
      // sigue activo y hay que poder seguir apuntando sin volver a apretar.
      const salir = () => { if (!scrubbing) setEyeProbe(null) }

      canvas.on('mouse:down', onDown)
      canvas.on('mouse:move', onMove)
      canvas.on('mouse:up', finish)
      canvas.on('mouse:out', salir)
      // Si se suelta el botón fuera del lienzo el canvas no se entera, y el
      // gotero se quedaba aplicando color sin estar apretado.
      window.addEventListener('mouseup', finish)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
        canvas.off('mouse:move', onMove)
        canvas.off('mouse:up', finish)
        canvas.off('mouse:out', salir)
        window.removeEventListener('mouseup', finish)
        finish()
        setEyeProbe(null)
        canvas.defaultCursor = 'default'
      })
    }

    // ── Formas: rectángulo / rect. redondeado / elipse / línea / polígono / estrella ──
    if (tool === 'rect' || tool === 'rrect' || tool === 'ellipse' || tool === 'line'
        || tool === 'polygon' || tool === 'star') {
      canvas.selection     = false
      canvas.defaultCursor = 'crosshair'
      let start: fabric.Point | null = null
      let shape: fabric.FabricObject | null = null
      let moved = false
      const centerBased = tool === 'polygon' || tool === 'star'
      const BASE_R = 50   // radio base de polígono/estrella; el tamaño real se logra escalando

      // Vértices (centrados en 0,0) de un polígono regular o de una estrella.
      const buildPolyPoints = () => {
        if (tool === 'star') {
          const n = Math.max(3, Math.round(starPointsRef.current))
          const pts: { x: number; y: number }[] = []
          for (let i = 0; i < n * 2; i++) {
            const r = i % 2 === 0 ? BASE_R : BASE_R * 0.45
            const a = -Math.PI / 2 + i * Math.PI / n
            pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) })
          }
          return pts
        }
        const n = Math.max(3, Math.round(polySidesRef.current))
        const pts: { x: number; y: number }[] = []
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / n
          pts.push({ x: BASE_R * Math.cos(a), y: BASE_R * Math.sin(a) })
        }
        return pts
      }

      const onDown = (e: fabric.TPointerEventInfo) => {
        start = e.scenePoint
        moved = false
        const stroke = colorRef.current
        const sw     = brushSizeRef.current
        // Sin relleno es SIN relleno. Antes caia en el color del trazo, asi que
        // una figura nueva salia maciza en vez de ser solo contorno.
        const fill   = fillRef.current
        const common = { strokeWidth: sw, strokeUniform: true, selectable: false, evented: false } as const
        if (tool === 'line') {
          shape = new fabric.Line([start.x, start.y, start.x, start.y],
            { ...common, stroke, strokeLineCap: 'round' })
        } else if (tool === 'rect' || tool === 'rrect') {
          shape = new fabric.Rect({ ...common, left: start.x, top: start.y, width: 1, height: 1, fill, stroke,
            rx: tool === 'rrect' ? 0 : undefined, ry: tool === 'rrect' ? 0 : undefined })
        } else if (tool === 'ellipse') {
          shape = new fabric.Ellipse({ ...common, left: start.x, top: start.y, rx: 0.5, ry: 0.5, fill, stroke })
        } else {
          // polígono / estrella: centrados en el click, crecen con el arrastre
          shape = new fabric.Polygon(buildPolyPoints(), {
            ...common, left: start.x, top: start.y, originX: 'center', originY: 'center',
            fill, stroke, scaleX: 0.002, scaleY: 0.002,
          })
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
        } else if (centerBased) {
          // radio = distancia arrastrada; el alto/ancho se logra escalando uniformemente
          const r = Math.max(1, Math.hypot(dx, dy))
          const s = r / BASE_R
          shape.set({ scaleX: s, scaleY: s })
        } else {
          if (shift) {  // cuadrado / círculo perfecto
            const m = Math.max(Math.abs(dx), Math.abs(dy))
            dx = (dx < 0 ? -1 : 1) * m; dy = (dy < 0 ? -1 : 1) * m
          }
          const left = Math.min(start.x, start.x + dx), top = Math.min(start.y, start.y + dy)
          const w = Math.abs(dx), h = Math.abs(dy)
          if (tool === 'rect' || tool === 'rrect') {
            const radius = tool === 'rrect' ? Math.min(24, Math.min(w, h) * 0.2) : 0
            ;(shape as fabric.Rect).set({ left, top, width: w, height: h, rx: radius, ry: radius })
          } else (shape as fabric.Ellipse).set({ left, top, rx: w / 2, ry: h / 2 })
        }
        shape.setCoords()
        canvas.requestRenderAll()
      }

      const onUp = (e: fabric.TPointerEventInfo) => {
        if (!shape) { start = null; return }
        if (!moved) {
          canvas.remove(shape); shape = null
          // Click sin arrastrar en rect/redondeado/elipse → pedir medidas exactas (estilo Illustrator)
          if ((tool === 'rect' || tool === 'rrect' || tool === 'ellipse') && start) {
            const ev = e.e as MouseEvent
            setExactDialog({ sx: start.x, sy: start.y, px: ev.clientX, py: ev.clientY, tool })
          }
          start = null
          return
        }
        shape.set({ selectable: true, evented: true })
        if (clipEnabledRef.current && clipPath.current) shape.clipPath = clipPath.current
        shape.setCoords()
        undoHistory.current.push({ type: 'add', obj: shape })
        redoHistory.current = []
        canvas.setActiveObject(shape)
        canvas.requestRenderAll()
        shape = null; start = null
        // Dibujada la figura, se vuelve a Seleccionar. Lo normal después de
        // dibujar es acomodar lo que dibujaste, no dibujar otra igual; quedarse
        // en la herramienta hacía que el primer clic para moverla creara una
        // figura nueva encima.
        setTool('select')
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

    // ── Símbolo (sello): estampa copias del símbolo activo al clickear ────────
    if (tool === 'symbol') {
      canvas.selection     = false
      canvas.defaultCursor = activeSymbolRef.current ? 'copy' : 'default'

      const onDown = async (e: fabric.TPointerEventInfo) => {
        const id  = activeSymbolRef.current
        const sym = symbolsRef.current.find(s => s.id === id)
        if (!sym) return
        const p = e.scenePoint
        const objs = await fabric.util.enlivenObjects([sym.json]) as fabric.FabricObject[]
        const obj  = objs[0]
        if (!obj) return
        obj.set({ left: p.x, top: p.y, originX: 'center', originY: 'center', selectable: true, evented: true })
        if (clipEnabledRef.current && clipPath.current) obj.clipPath = clipPath.current
        obj.setCoords()
        canvas.add(obj)
        undoHistory.current.push({ type: 'add', obj })
        redoHistory.current = []
        canvas.requestRenderAll()
      }
      canvas.on('mouse:down', onDown)
      offs.push(() => {
        canvas.off('mouse:down', onDown)
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
        // Si la textura guardada ya no existe (proyecto viejo), no se abre su
        // editor: pedirle la paleta a una textura borrada rompía el panel.
        const tex = (obj as any)._texture as { kind: TextureKind; colors: string[] } | undefined
        if (tex && esTexturaValida(tex.kind)) {
          setActiveTexKind(tex.kind); setTexColors(prev => ({ ...prev, [tex.kind]: tex.colors }))
        } else setActiveTexKind(null)
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

      const onCreated = (e: { selected: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
      const onUpdated = (e: { selected: fabric.FabricObject[] }) => syncProps(e.selected?.[0] ?? null)
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

      // Mover, escalar y rotar NO se anotaban en el historial: las entradas de
      // tipo 'transform' solo se creaban dentro del propio Ctrl+Z, así que no
      // había nada que deshacer y el atajo se saltaba el movimiento y borraba lo
      // anterior. Acá se anota cada transformación cuando termina.
      const onModified = (e: any) => {
        const target = e?.target as fabric.FabricObject | undefined
        if (!target) return
        // Fabric guarda en la propia transformación cómo estaba el objeto al
        // empezar a arrastrarlo: es exactamente el "antes" que hace falta.
        const antes = e?.transform?.original
        if (!antes) return

        if (target.type === 'activeselection') {
          const dx = (target.left ?? 0) - (antes.left ?? 0)
          const dy = (target.top ?? 0) - (antes.top ?? 0)
          if (dx === 0 && dy === 0) return   // se escaló o rotó el grupo: no se cubre
          undoHistory.current.push({
            type: 'moveDelta',
            objs: (target as fabric.ActiveSelection).getObjects(),
            dx, dy,
          })
        } else {
          undoHistory.current.push({
            type: 'transform',
            items: [{
              obj: target,
              left: antes.left ?? 0, top: antes.top ?? 0,
              scaleX: antes.scaleX ?? 1, scaleY: antes.scaleY ?? 1,
              angle: antes.angle ?? 0,
            }],
          })
        }
        redoHistory.current = []

        // Si lo que se movió es parte de la prenda, el recorte tiene que seguirla.
        // Si no, el diseño se recorta contra el molde viejo y desaparece.
        const tocoLaPrenda = mockupObjects.current.includes(target) ||
          (target.type === 'activeselection' &&
            (target as fabric.ActiveSelection).getObjects().some(o => mockupObjects.current.includes(o))) ||
          !!(target as any)._garmentGroup
        if (tocoLaPrenda) void rebuildGarmentClip()
      }

      canvas.on('mouse:down', onDownMockup)
      canvas.on('selection:created', onCreated)
      canvas.on('selection:updated', onUpdated)
      canvas.on('selection:cleared', onCleared)
      canvas.on('object:scaling',    onScaled)
      canvas.on('object:moving',    onMoved)
      canvas.on('object:rotating',  onRotated)
      canvas.on('object:modified',  onModified)

      offs.push(() => {
        canvas.off('mouse:down', onDownMockup)
        canvas.off('selection:created', onCreated)
        canvas.off('selection:updated', onUpdated)
        canvas.off('selection:cleared', onCleared)
        canvas.off('object:scaling',    onScaled)
        canvas.off('object:moving',    onMoved)
        canvas.off('object:rotating',  onRotated)
        canvas.off('object:modified',  onModified)
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
        // Al terminar de escribir se vuelve a Seleccionar, no antes: cambiar la
        // herramienta con el cursor todavía dentro del texto cortaría la edición.
        text.on('editing:exited', () => setTool('select'))
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


  /**
   * Con qué ajustes calcar cada imagen.
   *
   * Antes se usaban los mismos para todo: 8 colores y descartar las formas
   * chicas. Eso rompe justo los logos con fondo, que es el caso más común.
   *
   * Por qué: un logo blanco y negro sobre fondo tiene los bordes suavizados, o
   * sea una franja de grises entre el negro y el blanco. Repartidos en 8 colores,
   * esos grises se vuelven bandas propias y el contorno sale carcomido y
   * manchado. Y descartar las formas chicas se come los detalles finos.
   *
   * Sin fondo no pasaba porque el borde suavizado se va en transparencia en vez
   * de convertirse en grises.
   *
   * Entonces primero se mira cuántos colores tiene de verdad la imagen, y si son
   * pocos —un logo, un dibujo plano— se la calca con esa cantidad exacta.
   */
  function opcionesDeCalco(data: ImageData, coloresPreparados?: number) {
    // Si la imagen ya vino limpia (colores planos y borde nítido), se le dice al
    // calcador cuántos colores hay y se le saca el desenfoque: en una imagen ya
    // plana, desenfocar solo redondea las esquinas y se come los detalles finos.
    if (coloresPreparados && coloresPreparados <= 8) {
      return {
        numberofcolors: Math.max(2, coloresPreparados),
        colorsampling: 0,        // paleta fija: no se inventa nada
        ltres: 0.1, qtres: 0.1,  // pega el contorno lo más posible al original
        pathomit: 1,             // casi no descarta formas: sobrevive el detalle fino
        rightangleenhance: true,
        blurradius: 0,           // la imagen YA está limpia: desenfocar la arruina
      }
    }
    const px = data.data
    const total = data.width * data.height
    // Se agrupan los colores en cubos gruesos: los bordes suavizados no son
    // colores de la imagen, son la transición entre dos, y no deben contarse.
    const cubos = new Map<number, number>()
    const paso = Math.max(1, Math.floor(total / 40000))   // como mucho 40k muestras
    let visibles = 0
    for (let i = 0; i < total; i += paso) {
      const p = i * 4
      if (px[p + 3] < 128) continue
      visibles++
      const k = (px[p] >> 5 << 10) | (px[p + 1] >> 5 << 5) | (px[p + 2] >> 5)
      cubos.set(k, (cubos.get(k) ?? 0) + 1)
    }
    // Solo cuentan los colores con presencia real; el resto son bordes.
    const minimo = Math.max(1, visibles * 0.01)
    const dominantes = [...cubos.values()].filter(n => n >= minimo).length

    if (dominantes <= 6) {
      // Arte plano: logos, siluetas, dibujos. Se calca con sus colores justos.
      return {
        numberofcolors: Math.max(2, dominantes),
        colorsampling: 0,        // paleta fija, no muestreada: sin bandas inventadas
        ltres: 0.5, qtres: 0.5,  // sigue el contorno de cerca
        pathomit: 2,             // casi no descarta formas: los detalles finos sobreviven
        rightangleenhance: true, // endereza los ángulos rectos, típicos de un logo
        blurradius: 1,           // funde el borde suavizado antes de decidir el color
      }
    }
    // Fotos e ilustraciones con degradados: hace falta más paleta, y descartar
    // las formas minúsculas para que no salgan miles de manchitas.
    return {
      numberofcolors: 16,
      colorsampling: 2,
      ltres: 1, qtres: 1,
      pathomit: 8,
      rightangleenhance: false,
      blurradius: 0,
    }
  }

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

      // La imagen se limpia ANTES de calcarla: se aplana la transparencia, se
      // agranda si es chica y cada píxel se pega al color más cercano de la
      // paleta real. Calcar el PNG crudo era lo que hacía que un logo simple
      // saliera hecho un desastre. Ver utils/calco.ts.
      const preparada = prepararParaCalco(img)
      const imageData = preparada.data

      // Vectorizar con imagetracerjs, con ajustes según qué clase de imagen es.
      const { default: ImageTracer } = await import('imagetracerjs')
      const svgStr: string = ImageTracer.imagedataToSVG(imageData, opcionesDeCalco(imageData, preparada.paleta.length))

      // Cargar el SVG en Fabric
      const { objects } = await fabric.loadSVGFromString(svgStr)
      let validObjs = objects.filter(Boolean) as fabric.FabricObject[]
      if (!validObjs.length) return

      // Fuera el fondo. El calcador devuelve el fondo como relleno, no como
      // vacío: sin esto el logo venía con un cuadrado atrás tapando la prenda, y
      // los huecos de adentro (el aire entre el brazo y el cuerpo) salían como
      // manchas blancas macizas.
      //
      // Si el PNG venía con fondo transparente, NADA de ese color es dibujo: se
      // descarta todo, y los huecos quedan huecos. Si el fondo era un color de
      // verdad, solo se descarta el rectángulo que tapa todo, porque una pieza
      // del logo puede ser justo de ese color.
      const areaTotal = (imageData.width * imageData.height) * 0.92
      const sinFondo = validObjs.filter(o => {
        if (!esColorDeFondo(o.fill, preparada.fondo)) return true
        if (preparada.fondoTransparente) return false
        return (o.width ?? 0) * (o.height ?? 0) < areaTotal
      })
      if (sinFondo.length) validObjs = sinFondo

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

  // ── Dividir la prenda con un trazo ─────────────────────────────────────────

  /** El encuadre de la prenda que se esta editando. */
  function encuadreActual() {
    return project.mockupId === 'tshirt' ? teeFitRef.current : prendaFitRef.current
  }

  /** Los puntos de un trazo, en coordenadas del LIENZO. */
  function puntosDelTrazo(obj: fabric.FabricObject): Punto[] {
    const m = obj.calcTransformMatrix()
    const llevar = (x: number, y: number): Punto => {
      const q = fabric.util.transformPoint(new fabric.Point(x, y), m)
      return [q.x, q.y]
    }
    const path = (obj as any).path
    if (path) {
      const off = (obj as any).pathOffset ?? { x: 0, y: 0 }
      return samplePathCommands(path, 3).map(q => llevar(q.x - off.x, q.y - off.y))
    }
    if (obj.type === 'line') {
      const l = obj as fabric.Line
      const cx = (l.x1! + l.x2!) / 2, cy = (l.y1! + l.y2!) / 2
      return [llevar(l.x1! - cx, l.y1! - cy), llevar(l.x2! - cx, l.y2! - cy)]
    }
    return []
  }

  /**
   * ¿Este trazo sirve para dividir? Solo si cruza alguna pieza de lado a lado.
   * Se usa para no ofrecer la opción cuando no va a hacer nada.
   */
  function trazoDivide(obj: fabric.FabricObject): Punto[] | null {
    const fit = encuadreActual()
    if (!fit || !mockupObjects.current.length) return null
    const enLienzo = puntosDelTrazo(obj)
    if (enLienzo.length < 2) return null
    // Del lienzo al dibujo: así el corte se estira junto con la prenda cuando se
    // cambia una medida, en vez de quedarse clavado donde se dibujó.
    const corte: Punto[] = enLienzo.map(([x, y]) => [(x - fit.ox) / fit.sc, (y - fit.oy) / fit.sc])
    const alguna = mockupObjects.current.some(o => {
      if ((o as any)._rawInner) return false
      const d = (o as any).path ? pathDeObjeto(o) : ''
      return d ? !!partirPoligono(aplanarTrazado(d), corte) : false
    })
    return alguna ? corte : null
  }

  /** Las piezas que parte ese trazo, por nombre. */
  function piezasQueDivide(corte: Punto[]): string[] {
    return mockupObjects.current.filter(o => {
      if ((o as any)._rawInner) return false
      const d = (o as any).path ? pathDeObjeto(o) : ''
      return d ? !!partirPoligono(aplanarTrazado(d), corte) : false
    }).map(o => (o as any)._pieceKey as string).filter(Boolean)
  }

  /**
   * Alarga el trazo por las dos puntas.
   *
   * El corte se guarda en coordenadas del dibujo, y al agrandar una medida la
   * pieza crece por los costados: un trazo que llegaba justo de borde a borde
   * se quedaba corto y la division desaparecia sola. Estirandolo bien lejos
   * sigue cruzando pase lo que pase, y como el alcance ya esta fijado por
   * nombre de pieza, el sobrante no toca nada que no corresponda.
   */
  function estirarTrazo(pts: Punto[]): Punto[] {
    if (pts.length < 2) return pts
    const largo = 4000
    const prolongar = (a: Punto, b: Punto): Punto => {
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const n = Math.hypot(dx, dy)
      if (n < 1e-6) return b
      return [b[0] + (dx / n) * largo, b[1] + (dy / n) * largo]
    }
    return [prolongar(pts[1], pts[0]), ...pts, prolongar(pts[pts.length - 2], pts[pts.length - 1])]
  }

  /** La pieza de la prenda que esta debajo de ese punto. */
  function piezaEn(pt: fabric.Point | undefined): fabric.FabricObject | null {
    if (!pt) return null
    const piezas = mockupObjects.current
    for (let i = piezas.length - 1; i >= 0; i--) {
      const o = piezas[i]
      if ((o as any)._rawInner) continue
      if (o.visible === false) continue
      if (o.containsPoint(pt)) return o
    }
    return null
  }

  /** El trazado de una pieza, en coordenadas del dibujo. */
  function pathDeObjeto(o: fabric.FabricObject): string {
    const path = (o as any).path as any[] | undefined
    if (!path) return ''
    let d = ''
    for (const c of path) {
      const cmd = c[0]
      d += cmd + ' ' + c.slice(1).map((n: number) => n.toFixed(2)).join(' ') + ' '
    }
    return d
  }

  /**
   * El trazo dibujado que pasa por ese punto.
   *
   * No se usa el buscador de Fabric porque los trazos del lápiz se crean sin
   * eventos —para poder seguir dibujando encima— y nunca los encontraría.
   */
  function trazoEn(pt: fabric.Point | undefined): fabric.FabricObject | null {
    const canvas = fc.current
    if (!canvas || !pt) return null
    const objs = canvas.getObjects()
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i]
      if (mockupObjects.current.includes(o)) continue
      if (o instanceof fabric.IText) continue
      if (!(o as any).path && o.type !== 'line') continue
      if (o.visible === false) continue
      o.setCoords()
      if (o.containsPoint(pt)) return o
    }
    return null
  }

  /** Parte la prenda con ese trazo y se queda con el corte. */
  function dividirPrendaCon(obj: fabric.FabricObject, soloPieza?: string) {
    const corte = trazoDivide(obj)
    if (!corte) {
      onToast?.('Ese trazo no cruza la prenda de lado a lado, así que no la divide.')
      return
    }
    const piezas = soloPieza ? [soloPieza] : piezasQueDivide(corte)
    cortesRef.current = [...cortesRef.current, { pts: estirarTrazo(corte), piezas }]
    setHayCortes(true)
    // El trazo deja de ser un dibujo: ahora es la costura entre las dos piezas,
    // y la dibuja el borde de cada una. Si se dejara, quedaría la línea doble.
    fc.current?.remove(obj)
    if (project.mockupId === 'tshirt') placeTee(measuresRef.current, true)
    else placePrenda(medidasRef.current, true)
    onToast?.('Prenda dividida. Ahora podés pintar cada parte por separado.')
  }

  /** Vuelve la prenda a sus piezas originales. */
  function quitarCortes() {
    cortesRef.current = []
    setHayCortes(false)
    if (project.mockupId === 'tshirt') placeTee(measuresRef.current, true)
    else placePrenda(medidasRef.current, true)
  }

  // ── Bordado ────────────────────────────────────────────────────────────────
  /**
   * Pasa lo seleccionado (un vector, una forma o un texto) a bordado.
   *
   * Queda como imagen y no como vector a propósito: el bordado es hilo, y el
   * hilo no tiene "relleno" ni "trazo" que se puedan seguir editando. Deshacer
   * devuelve el original de una sola vez.
   */
  async function convertirEnBordado() {
    const canvas = fc.current
    if (!canvas) return
    const activos = (canvas.getActiveObjects?.() ?? []).filter(o => !mockupObjects.current.includes(o))
    if (!activos.length) return

    setBordando(true)
    try {
      const nuevos: fabric.FabricObject[] = []
      for (const obj of activos) {
        // El hilo saca el color del objeto: primero el relleno, y si no tiene
        // (una figura que es solo contorno) el trazo.
        const f = obj.fill, st = obj.stroke
        const hilo = (typeof f === 'string' && f) ? f
                   : (typeof st === 'string' && st) ? st
                   : '#c8402f'

        // Se dibuja SIN rotación y el ángulo se le devuelve después a la imagen:
        // si no, el hilo sale escalonado en vez de derecho.
        const angulo = obj.angle ?? 0
        const centro = obj.getCenterPoint()
        // El recorte a la remera está en coordenadas del lienzo. Al dibujar el
        // objeto solo, ese recorte cae fuera y se lo come entero: la silueta
        // salía vacía y el bordado invisible. Se saca y se devuelve después.
        const recorte = obj.clipPath
        obj.clipPath = undefined
        obj.set({ angle: 0 }); obj.setCoords()
        let silueta: HTMLCanvasElement
        try {
          // Techo de resolución: un objeto muy grande haría un canvas enorme y
          // el bordado tardaría de más sin verse mejor.
          const lado = Math.max(obj.getScaledWidth(), obj.getScaledHeight()) || 1
          const mult = Math.min(BORDADO_MULT, Math.max(1, 1400 / lado))
          silueta = obj.toCanvasElement({ multiplier: mult })
          ;(silueta as any)._mult = mult
        } finally {
          obj.set({ angle: angulo }); obj.clipPath = recorte; obj.setCoords()
        }

        const mult = (silueta as any)._mult as number
        const bordado = renderBordado(silueta, hilo, bordadoAngulo)
        const img = await fabric.FabricImage.fromURL(bordado.toDataURL())
        img.set({
          originX: 'center', originY: 'center',
          left: centro.x, top: centro.y, angle: angulo,
          scaleX: 1 / mult, scaleY: 1 / mult,
          opacity: obj.opacity ?? 1, selectable: true, evented: true,
        })
        ;(img as any)._bordado = true
        if (clipEnabledRef.current && clipPath.current) img.clipPath = clipPath.current
        img.setCoords()
        canvas.remove(obj)
        canvas.add(img)
        nuevos.push(img)
      }
      canvas.discardActiveObject()
      if (nuevos.length === 1) { canvas.setActiveObject(nuevos[0]); setSelectedObj(nuevos[0]) }
      undoHistory.current.push({ type: 'erase', removed: activos, added: nuevos })
      redoHistory.current = []
      canvas.requestRenderAll()
      refreshLayersNow()
    } catch (err) {
      console.error('No se pudo bordar:', err)
    } finally {
      setBordando(false)
    }
  }

  // ── Texturas ─────────────────────────────────────────────────────────────────
  // Aplica un patrón de textura a un objeto y guarda su receta (kind + colores) para poder
  // recolorearla después sin perder la textura.
  function setObjTexture(obj: fabric.FabricObject, kind: TextureKind, colors: string[]) {
    ;(obj as any)._texture = { kind, colors: [...colors] }
    delete (obj as any)._baseColor          // la textura pasa a ser la base
    // Y reemplaza a la tela importada: recomposeFill atiende _userTex primero,
    // así que sin esto el estampado quedaba tapado y el clic no hacía nada.
    delete (obj as any)._userTex
    recomposeFill(obj)
  }

  // ── Composición base + efecto ───────────────────────────────────────────────
  // El relleno final de una pieza se arma con dos capas:
  //   base   → color liso (_baseColor) o estampado (_texture)
  //   efecto → desgaste/grunge/vintage (_effect), dibujado ENCIMA
  // Se rehace desde cero cada vez, así cambiar uno no pisa al otro.
  function recomposeFill(obj: fabric.FabricObject) {
    const texGuardada = (obj as any)._texture as { kind: TextureKind; colors: string[] } | undefined
    // Una textura que ya no existe (proyecto viejo con cuadrillé, lunares,
    // camuflado o animal) se descarta: la pieza queda con su color liso.
    const tex    = texGuardada && esTexturaValida(texGuardada.kind) ? texGuardada : undefined
    const eff    = (obj as any)._effect  as { kind: EffectKind; intensity: number } | undefined
    const baseCol = (obj as any)._baseColor as string | undefined
    const uTex   = (obj as any)._userTex as { id: string; widthCm: number } | undefined

    // ── Textura propia del usuario ──
    // Se dibuja A ESCALA REAL: el tile mide exactamente los cm que el usuario
    // declaró que mide la muestra de tela. Así una raya de 1 cm se ve de 1 cm
    // sobre la prenda, y lo que se manda al taller no miente.
    if (uTex) {
      const img = userTexImages.current.get(uTex.id)
      if (img && img.complete && img.naturalWidth > 0) {
        const pxPerCm = pxPerCmRef.current || 5
        const w = Math.max(8, Math.round(uTex.widthCm * pxPerCm))
        const h = Math.max(8, Math.round(w * (img.naturalHeight / img.naturalWidth)))
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const x = c.getContext('2d')!
        x.drawImage(img, 0, 0, w, h)
        if (eff) paintEffect(x, eff.kind, Math.max(0, Math.min(1, eff.intensity)), Math.max(w, h))
        obj.set({ fill: new fabric.Pattern({ source: c, repeat: 'repeat' }) as any, dirty: true })
        return
      }
      // Imagen todavía no cargada: se resuelve sola al terminar la precarga.
    }

    // Sin efecto: patrón simple (o color liso), como antes.
    if (!eff) {
      if (tex) {
        const tile = makeTextureCanvas(tex.kind, tex.colors)
        obj.set({ fill: new fabric.Pattern({ source: tile, repeat: 'repeat' }) as any, dirty: true })
      } else if (baseCol) {
        obj.set({ fill: baseCol, dirty: true })
      }
      return
    }

    // Con efecto: se compone en un tile grande (múltiplo del de estampado).
    const s = EFFECT_TILE
    const c = document.createElement('canvas'); c.width = s; c.height = s
    const x = c.getContext('2d')!

    if (tex) {
      const t = makeTextureCanvas(tex.kind, tex.colors)      // 56×56
      for (let iy = 0; iy < s; iy += t.height)
        for (let ix = 0; ix < s; ix += t.width) x.drawImage(t, ix, iy)
    } else {
      const f = obj.fill
      x.fillStyle = baseCol ?? (typeof f === 'string' && f ? f : '#c9c9c9')
      x.fillRect(0, 0, s, s)
    }

    paintEffect(x, eff.kind, Math.max(0, Math.min(1, eff.intensity)), s)
    obj.set({ fill: new fabric.Pattern({ source: c, repeat: 'repeat' }) as any, dirty: true })
  }

  // Aplica una textura propia del usuario a la prenda (o a la pieza seleccionada).
  function applyUserTexture(t: UserTexture) {
    const img = userTexImages.current.get(t.id)
    if (!img) {                                   // precargar y reintentar
      // Las de fábrica pasan por ensureRawImage, que además les aplica los
      // colores elegidos antes de que la tela toque la prenda.
      if (isRawTexture(t.id)) {
        ensureRawImage(t.id).then(ok => { if (ok) applyUserTexture(t) })
        return
      }
      const el = new Image()
      el.onload = () => { userTexImages.current.set(t.id, el); applyUserTexture(t) }
      el.src = t.dataUrl
      return
    }
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => {
      delete (o as any)._texture               // reemplaza al estampado interno
      delete (o as any)._baseColor
      ;(o as any)._userTex = { id: t.id, widthCm: t.widthCm }
      recomposeFill(o)
    }, `Tela «${t.name}» aplicada`, label)
    setActiveTexKind(null)
    setActiveUserTex(t.id)
  }

  // Cambia la escala (cm) de la textura propia ya aplicada y la redibuja.
  function setUserTexScale(id: string, widthCm: number) {
    const canvas = fc.current
    if (!canvas) return
    canvas.getObjects().forEach(o => {
      const u = (o as any)._userTex as { id: string; widthCm: number } | undefined
      if (u?.id === id) { u.widthCm = widthCm; recomposeFill(o) }
    })
    setUserTextures(prev => prev.map(t => (t.id === id ? { ...t, widthCm } : t)))
    // Las de fábrica no viven en IndexedDB: su ancho va a localStorage.
    if (isRawTexture(id)) {
      saveRawWidth(id, widthCm)
    } else {
      const t = userTextures.find(x => x.id === id)
      if (t) updateUserTexture({ ...t, widthCm })
    }
    markDirty()
    canvas.requestRenderAll()
  }

  // Piezas de la prenda que pueden recibir tela/color (las que tienen área de relleno).
  function fillableGarmentPieces(): fabric.FabricObject[] {
    return mockupObjects.current.filter(o => {
      if (o.visible === false) return false
      if ((o as any)._rawInner) return false   // el hueco del cuello no es una pieza
      const f = (o as any).fill
      return typeof f === 'string' ? (f !== '' && f !== 'transparent') : f != null
    })
  }

  // El interior sigue al color de la prenda, apagado, para que se lea como el
  // revés de la tela. Si la prenda tiene estampado no hay color liso del que
  // salir, y ahí cae en el gris neutro.
  function syncInnerShade() {
    const inner = mockupObjects.current.find(o => (o as any)._rawInner)
    if (!inner) return
    const body = mockupObjects.current.find(o => (o as any)._rawBody)
    const base = body ? (body as any)._baseColor as string | undefined : undefined
    const plain = base && /^#[0-9a-f]{6}$/i.test(base)
    inner.set({ fill: plain ? adjL(base!, -0.16) : TEE_INNER_FALLBACK, dirty: true })
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
    // El hueco del cuello se filtra acá y no en cada llamador: es el único paso
    // por el que entra cualquier pintura, así que blindarlo una vez alcanza.
    targets = targets.filter(o => !(o as any)._rawInner)
    if (!targets.length) { onToast?.('No hay nada para pintar — elegí una pieza o creá una figura'); return }
    const items = targets.map(o => ({ obj: o, prev: snapshotPaint(o) }))
    targets.forEach(mut)
    syncInnerShade()
    undoHistory.current.push(items.length === 1
      ? { type: 'fill', obj: items[0].obj, prev: items[0].prev }
      : { type: 'fillBatch', items })
    redoHistory.current = []
    canvas.requestRenderAll()
    markDirty()
    onToast?.(`${verb} a ${label}`)
  }

  function applyTexture(kind: TextureKind) {
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => setObjTexture(o, kind, texColors[kind]), 'Tela aplicada', label)
    setActiveTexKind(kind)
    setActiveUserTex(null)
  }

  // ── Efectos de tela ─────────────────────────────────────────────────────────
  function applyEffect(kind: EffectKind, intensity: number) {
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => {
      // Si la pieza tenía color liso y aún no lo registramos, guardarlo como base.
      if (!(o as any)._texture && !(o as any)._baseColor && typeof o.fill === 'string' && o.fill) {
        ;(o as any)._baseColor = o.fill
      }
      ;(o as any)._effect = { kind, intensity }
      recomposeFill(o)
    }, 'Efecto aplicado', label)
    setActiveEffect(kind)
    setEffectIntensity(intensity)
  }

  function removeEffect() {
    const { targets, label } = fillTargets()
    applyFillToTargets(targets, o => {
      delete (o as any)._effect
      recomposeFill(o)
    }, 'Efecto quitado', label)
    setActiveEffect(null)
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

  // Caja combinada del mockup (remera) — usada por el snapping / guías inteligentes.
  function mockupBounds(): { left: number; top: number; width: number; height: number } | null {
    const m = mockupObjects.current
    if (!m.length) return null
    const r = m.map(o => o.getBoundingRect())
    const minX = Math.min(...r.map(b => b.left)), minY = Math.min(...r.map(b => b.top))
    const maxX = Math.max(...r.map(b => b.left + b.width)), maxY = Math.max(...r.map(b => b.top + b.height))
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
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

      // Atajos con Shift — herramientas alternativas / acciones (estilo Illustrator)
      if (!ctrl && !e.altKey && e.shiftKey) {
        switch (e.key) {
          case 'E': setTool('eraser'); return   // Shift+E — goma
          case 'H': flipSelected('x'); return   // Shift+H — reflejar horizontal
          case 'V': flipSelected('y'); return   // Shift+V — reflejar vertical
        }
      }

      // Atajos de herramienta (un solo carácter, sin Ctrl/Alt/Shift) — al estilo Illustrator
      if (!ctrl && !e.altKey && !e.shiftKey) {
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
          case 'k': case 'K': setTool('fill');       return   // K — balde (relleno)
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

      // Flechas — mover lo seleccionado de a un píxel (10 con Shift).
      // Es la forma de acomodar algo con precisión: a mano el mouse nunca cae
      // justo, y con esto se ajusta sin pelear con el pulso.
      // Con Alt las flechas cambian de pestana (lo maneja App), no mueven nada.
      if (!ctrl && !e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const activo = canvas.getActiveObject()
        if (!activo) return
        e.preventDefault()
        const paso = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -paso : e.key === 'ArrowRight' ? paso : 0
        const dy = e.key === 'ArrowUp'   ? -paso : e.key === 'ArrowDown'  ? paso : 0

        const movidos = activo.type === 'activeselection'
          ? (activo as fabric.ActiveSelection).getObjects()
          : [activo]

        activo.set({ left: (activo.left ?? 0) + dx, top: (activo.top ?? 0) + dy })
        activo.setCoords()

        // Un solo paso de deshacer por rafaga: mantener la flecha apretada
        // genera decenas de eventos, y tener que deshacer cincuenta veces para
        // volver atras un ajuste seria peor que no poder deshacerlo.
        const ultima = undoHistory.current[undoHistory.current.length - 1]
        const mismaRafaga = ultima?.type === 'moveDelta' &&
          ultima.objs.length === movidos.length &&
          ultima.objs.every((o, i) => o === movidos[i]) &&
          Date.now() - ultimaFlecha.current < 900
        if (mismaRafaga && ultima.type === 'moveDelta') {
          ultima.dx += dx; ultima.dy += dy
        } else {
          undoHistory.current.push({ type: 'moveDelta', objs: movidos, dx, dy })
          redoHistory.current = []
        }
        ultimaFlecha.current = Date.now()

        if (mockupObjects.current.includes(activo) ||
            movidos.some(o => mockupObjects.current.includes(o))) void rebuildGarmentClip()
        markDirty()
        canvas.requestRenderAll()
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
        // Se suelta la seleccion ANTES de tocar nada. Mientras hay una seleccion
        // multiple activa, las coordenadas de cada objeto son relativas al centro
        // de esa seleccion: mover uno ahi adentro lo manda a cualquier lado. Al
        // soltarla, Fabric vuelve a dejar todo en coordenadas absolutas.
        canvas.discardActiveObject()
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
          const cur = entry.items.map(it => snapGeom(it.obj))
          entry.items.forEach(applyGeom)
          undoHistory.current.push({ type: 'transform', items: cur })
        } else if (entry.type === 'moveDelta') {
          const signo = 1    // rehacer: se vuelve a aplicar el desplazamiento
          entry.objs.forEach(o => { o.set({ left: (o.left ?? 0) + signo * entry.dx, top: (o.top ?? 0) + signo * entry.dy }); o.setCoords() })
          undoHistory.current.push(entry)
        } else if (entry.type === 'props') {
          const cur: Record<string, any> = {}
          for (const k of Object.keys(entry.prev)) cur[k] = (entry.obj as any).get(k)
          entry.obj.set(entry.prev as any); entry.obj.setCoords()
          undoHistory.current.push({ type: 'props', obj: entry.obj, prev: cur })
        } else if (entry.type === 'fillBatch') {
          const cur = entry.items.map(it => ({ obj: it.obj, prev: snapshotPaint(it.obj) }))
          entry.items.forEach(it => applyPaint(it.obj, it.prev))
          syncInnerShade()
          undoHistory.current.push({ type: 'fillBatch', items: cur })
        } else {
          const cur = snapshotPaint(entry.obj)
          applyPaint(entry.obj, entry.prev)
          syncInnerShade()
          undoHistory.current.push({ type: 'fill', obj: entry.obj, prev: cur })
        }
        markDirty()   // deshacer y rehacer tambien cambian el diseño
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        return
      }

      // Ctrl+Z — undo
      if (!e.shiftKey && e.key === 'z') {
        e.preventDefault()
        // Si hay un trazo de pluma en curso, Ctrl+Z borra el ultimo punto de ESE
        // trazo. Sin esto deshacia lo anterior ya guardado mientras lo que estabas
        // dibujando quedaba intacto, que es justo al reves de lo que uno espera.
        if (penDraftRef.current?.hasDraft()) { penDraftRef.current.undoPoint(); return }
        const entry = undoHistory.current.pop()
        if (!entry) return
        // Se suelta la seleccion ANTES de tocar nada. Mientras hay una seleccion
        // multiple activa, las coordenadas de cada objeto son relativas al centro
        // de esa seleccion: mover uno ahi adentro lo manda a cualquier lado. Al
        // soltarla, Fabric vuelve a dejar todo en coordenadas absolutas.
        canvas.discardActiveObject()
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
          const cur = entry.items.map(it => snapGeom(it.obj))
          entry.items.forEach(applyGeom)
          redoHistory.current.push({ type: 'transform', items: cur })
        } else if (entry.type === 'moveDelta') {
          const signo = -1   // deshacer: se resta el desplazamiento
          entry.objs.forEach(o => { o.set({ left: (o.left ?? 0) + signo * entry.dx, top: (o.top ?? 0) + signo * entry.dy }); o.setCoords() })
          redoHistory.current.push(entry)
        } else if (entry.type === 'props') {
          const cur: Record<string, any> = {}
          for (const k of Object.keys(entry.prev)) cur[k] = (entry.obj as any).get(k)
          entry.obj.set(entry.prev as any); entry.obj.setCoords()
          redoHistory.current.push({ type: 'props', obj: entry.obj, prev: cur })
        } else if (entry.type === 'fillBatch') {
          const cur = entry.items.map(it => ({ obj: it.obj, prev: snapshotPaint(it.obj) }))
          entry.items.forEach(it => applyPaint(it.obj, it.prev))
          syncInnerShade()
          redoHistory.current.push({ type: 'fillBatch', items: cur })
        } else {
          const cur = snapshotPaint(entry.obj)
          applyPaint(entry.obj, entry.prev)
          syncInnerShade()
          redoHistory.current.push({ type: 'fill', obj: entry.obj, prev: cur })
        }
        markDirty()   // deshacer y rehacer tambien cambian el diseño
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

  // La imagen que se ve en la tarjeta del proyecto.
  //
  // Antes se sacaba una foto de la pantalla tal cual estaba: si el diseñador
  // había hecho zoom o movido el lienzo, la tarjeta quedaba con un pedazo de la
  // prenda o directamente con el vacío de al lado. Y aunque no tocara el zoom,
  // la prenda ocupaba una parte chica de un lienzo grande y la tarjeta salía
  // casi toda fondo.
  //
  // Ahora se recorta la PRENDA: se apaga el zoom un instante, se mide dónde
  // está y se fotografía solo eso. El resultado no depende de cómo el diseñador
  // dejó la vista.
  function garmentThumbnail(canvas: fabric.Canvas): string {
    const objs = mockupObjects.current
    const vpt = canvas.viewportTransform
    try {
      if (objs.length) {
        canvas.viewportTransform = [1, 0, 0, 1, 0, 0]
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
        for (const o of objs) {
          const r = o.getBoundingRect()
          x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top)
          x2 = Math.max(x2, r.left + r.width); y2 = Math.max(y2, r.top + r.height)
        }
        if (Number.isFinite(x1) && x2 > x1 && y2 > y1) {
          const pad = Math.max(x2 - x1, y2 - y1) * 0.04
          const w = x2 - x1 + pad * 2, h = y2 - y1 + pad * 2
          // ~320 px de alto: el doble de lo que mide la tarjeta, para que no se
          // vea borrosa en pantallas retina sin guardar una imagen enorme.
          return canvas.toDataURL({
            format: 'png', multiplier: Math.min(2, 320 / h),
            left: x1 - pad, top: y1 - pad, width: w, height: h,
          })
        }
      }
      return canvas.toDataURL({ format: 'png', multiplier: 0.3 })
    } finally {
      if (vpt) canvas.viewportTransform = vpt
      canvas.requestRenderAll()
    }
  }

  // ── Guardado automático ────────────────────────────────────────────────────
  // Guardar a mano es una cosa más que el diseñador tiene que acordarse de
  // hacer, y la única consecuencia de olvidarse es perder el trabajo.
  //
  // No se guarda en cada trazo: se espera a que pare de hacer cosas. Cada cambio
  // reinicia el reloj, así dibujar diez líneas seguidas es UN guardado y no diez.
  const AUTOSAVE_MS = 2000
  const autosaveListo = useRef(false)     // no guardar mientras se abre el proyecto
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guardando     = useRef(false)

  function markDirty() {
    if (!autosaveListo.current) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { void autoSave() }, AUTOSAVE_MS)
  }

  async function autoSave() {
    const payload = buildSavePayload()
    if (!payload) return
    // Si ya hay un guardado en vuelo, se reintenta después en vez de mandar dos
    // versiones a la vez y que gane la que conteste última.
    if (guardando.current) { markDirty(); return }
    guardando.current = true
    try { await onSave(payload.thumbnail, payload.canvasJson) }
    finally { guardando.current = false }
  }

  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }, [])

  // Lo que se manda a guardar. Lo usan el guardado a mano y el automático: si
  // fueran dos armados distintos, tarde o temprano guardarían cosas distintas.
  function buildSavePayload(): { thumbnail: string; canvasJson: string } | null {
    const canvas = fc.current
    if (!canvas) return null
    const userObjs = canvas.getObjects()
      // Fuera la prenda (se reconstruye desde las medidas) y fuera lo temporal:
      // los tiradores de anclaje y los previews del lapiz y de la pluma son
      // objetos reales del lienzo, y el guardado automatico saltaba a los 2 s de
      // dejar de mover el mouse, o sea EN MEDIO del trazo. Asi se guardaban
      // circulitos azules y lineas punteadas como si fueran parte del diseno.
      .filter(o => !(o as any)._rawMockup && !(o as any)._rawTemp)
      .map(o => { const j = o.toObject(['_texture', '_effect', '_baseColor', '_userTex']); delete j.clipPath; return j })

    // La prenda se guarda por separado porque no se restaura como objeto: se
    // vuelve a construir desde las medidas y después se le repone la pintura.
    const garment: SavedGarment = {
      measures: measuresRef.current,
      medidas:  medidasRef.current,
      medidasV: 2,
      cortes:   cortesRef.current,
      pieces: mockupObjects.current.map(o => ({
        key:  (o as any)._pieceKey as string | undefined,
        fill: typeof o.fill === 'string' ? o.fill : undefined,
        tex:  (o as any)._texture,
        eff:  (o as any)._effect,
        base: (o as any)._baseColor,
        uTex: (o as any)._userTex,
      })),
    }
    return {
      canvasJson: JSON.stringify({ v: 2, objects: userObjs, garment }),
      thumbnail: garmentThumbnail(canvas),
    }
  }

  async function handleSave() {
    const payload = buildSavePayload()
    if (!payload) return
    // El guardado a mano cancela el automático pendiente: si no, guardaría dos
    // veces lo mismo con dos segundos de diferencia.
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null }
    // Se espera al guardado de verdad. Avisar "Guardado ✓" antes de que la base
    // conteste hacía que el cartel de error y el de éxito salieran juntos, y el
    // diseñador se iba pensando que su trabajo estaba a salvo.
    if (await onSave(payload.thumbnail, payload.canvasJson)) onSaveComplete()
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
  /**
   * Rehace el recorte a partir de dónde está la prenda AHORA.
   *
   * El recorte es lo que hace que el diseño no se salga de la prenda, y está
   * anclado a coordenadas absolutas. Al mover la prenda, el recorte se quedaba
   * donde estaba: el diseño pasaba a recortarse contra un molde que ya no
   * coincidía con nada y desaparecía. Por eso solo se veía con la prenda en su
   * posición original.
   */
  async function rebuildGarmentClip() {
    const canvas = fc.current
    if (!canvas) return
    const piezas = mockupObjects.current.filter(o => {
      if (o.visible === false) return false
      if ((o as any)._rawInner) return false    // el hueco del cuello no define la silueta
      const f = (o as any).fill
      return typeof f === 'string' ? (f !== '' && f !== 'transparent') : f != null
    })
    if (!piezas.length) return

    const copias = await Promise.all(piezas.map(p => p.clone()))
    const cg = new fabric.Group(copias)
    cg.absolutePositioned = true
    clipPath.current = cg

    canvas.getObjects().forEach(o => {
      if (mockupObjects.current.includes(o) || o instanceof fabric.IText) return
      o.clipPath = clipEnabledRef.current ? cg : undefined
      o.dirty = true
    })
    canvas.requestRenderAll()
  }

  /** Devuelve la prenda al centro del lienzo. */
  // Cuando el encuadre lo puso el programa (y no el diseñador a mano), se puede
  // deshacer solo al volver la prenda a un tamaño que entra.
  const encuadreAuto = useRef(false)

  /**
   * Aleja la vista lo justo para que la prenda entre entera en el lienzo.
   *
   * La escala del DIBUJO es fija a propósito: así alargar una prenda se ve más
   * larga y no más chica, y los cm significan algo. El costo era que una prenda
   * larga o muy ancha se salía del lienzo. Lo que se mueve acá es la VISTA, no
   * la prenda: el zoom baja hasta que entra, y vuelve a 1 cuando deja de hacer
   * falta. Nunca se acerca más allá de 1, y si el diseñador movió o acercó la
   * vista a mano no se le pisa.
   */
  function encuadrarPrenda() {
    const canvas = fc.current
    if (!canvas) return
    const objs = mockupObjects.current
    if (!objs.length) return
    if (panned && !encuadreAuto.current) return

    // Se mide con el zoom apagado: la caja de la prenda es del DIBUJO, no de lo
    // que se ve ahora.
    const vpt = canvas.viewportTransform
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0]
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const o of objs) {
      if (o.visible === false) continue
      const r = o.getBoundingRect()
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top)
      x2 = Math.max(x2, r.left + r.width); y2 = Math.max(y2, r.top + r.height)
    }
    if (vpt) canvas.viewportTransform = vpt
    if (!isFinite(x1) || x2 <= x1 || y2 <= y1) return

    const W = canvas.getWidth(), H = canvas.getHeight()
    const margen = 0.94                       // un respiro contra los bordes
    const z = Math.min(1, (W * margen) / (x2 - x1), (H * margen) / (y2 - y1))

    if (z >= 0.999 && !encuadreAuto.current) return   // entra sola y nadie tocó nada
    encuadreAuto.current = z < 0.999
    const cxG = (x1 + x2) / 2, cyG = (y1 + y2) / 2
    canvas.setViewportTransform([z, 0, 0, z, W / 2 - cxG * z, H / 2 - cyG * z])
    canvas.requestRenderAll()
    setZoom(z)
    setPanned(false)
  }

  function centrarPrenda() {
    const canvas = fc.current
    if (!canvas) return
    const objs = mockupObjects.current
    if (!objs.length) return

    // Se mide con el zoom apagado: si no, "el centro" sería el centro de lo que
    // se ve ahora y la prenda quedaría centrada en otro lado al alejar.
    const vpt = canvas.viewportTransform
    canvas.viewportTransform = [1, 0, 0, 1, 0, 0]
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const o of objs) {
      const r = o.getBoundingRect()
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top)
      x2 = Math.max(x2, r.left + r.width); y2 = Math.max(y2, r.top + r.height)
    }
    const dx = canvas.getWidth() / 2 - (x1 + x2) / 2
    const dy = canvas.getHeight() / 2 - (y1 + y2) / 2
    if (vpt) canvas.viewportTransform = vpt

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { onToast?.('La prenda ya está centrada'); return }

    const antes = objs.map(snapGeom)
    objs.forEach(o => { o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy }); o.setCoords() })
    undoHistory.current.push({ type: 'transform', items: antes })
    redoHistory.current = []
    void rebuildGarmentClip()
    markDirty()
    canvas.requestRenderAll()
    onToast?.('Prenda centrada')
  }

  function placeTee(m: Measures, reassignClip = false) {
    const canvas = fc.current
    if (!canvas) return
    const CW = canvas.getWidth(), CH = canvas.getHeight()
    // Guardar la tela/color aplicado a cada pieza ANTES de rehacer la remera, para no
    // perderlo al cambiar las medidas (se restaura por índice — las piezas no cambian de orden).
    const prevPaint = mockupObjects.current.map(o => ({
      fill: (o as any).fill,
      tex:  (o as any)._texture as { kind: TextureKind; colors: string[] } | undefined,
      eff:  (o as any)._effect  as { kind: EffectKind; intensity: number } | undefined,
      base: (o as any)._baseColor as string | undefined,
      // Sin esto, tocar una medida borraba la tela importada de la prenda: el
      // relleno se rehace desde cero y _userTex no viajaba en la copia.
      uTex: (o as any)._userTex as { id: string; widthCm: number } | undefined,
    }))
    mockupPrevKeys.current = mockupObjects.current.map(o => (o as any)._pieceKey as string ?? '')
    mockupObjects.current.forEach(o => canvas.remove(o))

    const shapes = aplicarCortes(buildTeeShapes(m), cortesRef.current)
    let objsConCuerpo = false
    const objs = shapes.map(s => {
      const p = new fabric.Path(s.d, {
        fill: s.fill ?? null, stroke: s.stroke, strokeWidth: s.strokeWidth,
        selectable: false,
        // El interior y las lineas de detalle no se pintan, asi que tampoco
        // reciben el clic: lo atraviesa y cae en la pieza de abajo, que es la
        // que el disenador quiso tocar. Sin esto el balde rellenaba de golpe
        // el contorno del cuello o una costura y la prenda quedaba manchada.
        evented: s.role !== 'inner' && !(s.role === 'detail' && !s.fill),
        hoverCursor: 'crosshair', strokeUniform: true,
      })
      ;(p as any)._rawMockup = true
      ;(p as any)._pieceKey = s.key
      if (s.nombre) (p as any)._pieceName = s.nombre
      if (s.role === 'inner') (p as any)._rawInner = true
      // _rawBody marca de donde saca el color el interior del cuello: es el
      // CUERPO, no las mangas, asi el escote acompana a lo que se ve detras.
      // Si el cuerpo esta dividido, el que manda es el primer pedazo: el de
      // arriba, que es el que se ve por el hueco.
      if (s.key === 'cuerpo' || s.key.startsWith('cuerpo#')) {
        if (!objsConCuerpo) { (p as any)._rawBody = true; objsConCuerpo = true }
      }
      return p
    })
    // Restaurar tela/color/efecto por pieza (la remera se reconstruye al cambiar
    // medidas). Se busca por NOMBRE de pieza y no por posicion: si algun dia
    // cambia la cantidad de piezas, la pintura sigue cayendo donde corresponde.
    const porNombre = new Map<string, typeof prevPaint[number]>()
    prevPaint.forEach((pp, i) => {
      const k = (mockupPrevKeys.current[i] ?? '') as string
      if (k) porNombre.set(k, pp)
    })
    if (prevPaint.length) {
      objs.forEach((o, i) => {
        if ((o as any)._rawInner) return      // nunca lleva pintura del usuario
        const clave = (o as any)._pieceKey as string | undefined
        // Un pedazo recien nacido (`cuerpo#1`) hereda la pintura de la pieza de
        // la que salio, asi dividir no cambia como se ve la prenda.
        const pp = (clave ? porNombre.get(clave) : undefined)
          ?? (clave ? porNombre.get(clave.split('#')[0]) : undefined)
          ?? (prevPaint.length === objs.length ? prevPaint[i] : undefined)
        if (!pp) return
        if (pp.tex)  (o as any)._texture   = pp.tex
        if (pp.eff)  (o as any)._effect    = pp.eff
        if (pp.uTex) (o as any)._userTex   = pp.uTex
        // Sin tela, el color liso que estaba dibujado MANDA sobre la base: los
        // disenos guardados antes de que el balde registrara la base traen las
        // dos cosas desincronizadas, y tocar una medida los devolvia al color
        // viejo en vez de dejar el que se veia en pantalla.
        const colorLiso = !pp.tex && !pp.uTex && typeof pp.fill === 'string' && pp.fill !== ''
        if (colorLiso)    (o as any)._baseColor = pp.fill
        else if (pp.base) (o as any)._baseColor = pp.base
        if ((o as any)._baseColor || pp.tex || pp.eff || pp.uTex) recomposeFill(o)
        else if (typeof pp.fill === 'string' && pp.fill !== '') o.set({ fill: pp.fill })
      })
    }
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
    syncInnerShade()

    // Clip = unión de todas las piezas (cuerpo + mangas)
    const clipObjs = shapes.filter(s => s.role === 'piece').map(s => {
      const p = new fabric.Path(s.d, { fill: '#000' })
      p.set({ left: (p.left ?? 0) * sc + ox, top: (p.top ?? 0) * sc + oy, scaleX: sc, scaleY: sc })
      return p
    })
    const cg = new fabric.Group(clipObjs); cg.absolutePositioned = true
    clipPath.current = cg
    // px reales por cm = unidades del path por cm x escala de encuadre.
    // (antes se guardaba solo `sc`, y el estampado importado salia ~5x chico)
    pxPerCmRef.current = sc * TEE_UNITS_PER_CM

    for (let i = objs.length - 1; i >= 0; i--) canvas.sendObjectToBack(objs[i])
    if (reassignClip) {
      canvas.getObjects().forEach(o => {
        if (mockupObjects.current.includes(o) || o instanceof fabric.IText) return
        o.clipPath = clipEnabledRef.current ? cg : undefined
        o.dirty = true
      })
    }
    canvas.requestRenderAll()
    encuadrarPrenda()
    refreshLayersNow()
  }

  /**
   * Arma el pantalón o la chomba con las medidas dadas.
   *
   * Mismo criterio que la remera: la prenda se REHACE moviendo los puntos del
   * dibujo, no se escala. Por eso alargar no ensancha.
   *
   * La escala de pantalla se calcula UNA vez, con las medidas por defecto, y
   * después no se toca: si se recalculara en cada cambio, agrandar una medida
   * volvería a encuadrar la prenda y se vería del mismo tamaño que antes — o
   * sea, no se notaría nada.
   */
  function placePrenda(m: Medidas, reassignClip = false) {
    const canvas = fc.current
    const piezas = piezasRef.current
    if (!canvas || !prendaParam || !piezas.length) return
    const CW = canvas.getWidth(), CH = canvas.getHeight()

    // Guardar la tela/color de cada pieza antes de rehacerla (mismo motivo que
    // en la remera: el relleno se reconstruye de cero y si no se pierde).
    const prevPaint = mockupObjects.current.map(o => ({
      fill: (o as any).fill,
      tex:  (o as any)._texture as { kind: TextureKind; colors: string[] } | undefined,
      eff:  (o as any)._effect  as { kind: EffectKind; intensity: number } | undefined,
      base: (o as any)._baseColor as string | undefined,
      uTex: (o as any)._userTex as { id: string; widthCm: number } | undefined,
      key:  (o as any)._pieceKey as string | undefined,
    }))
    mockupObjects.current.forEach(o => canvas.remove(o))

    // Las piezas, ya con los cortes aplicados. Se devuelve tambien de que pieza
    // del archivo salio cada una, porque la correccion de la segunda mitad y el
    // recorte trabajan sobre esa lista.
    const expandir = (mm: Medidas) => {
      const out: { pz: PiezaSvg; d: string; key: string; nombre: string }[] = []
      for (const pz of piezas) {
        const d = transformPath(pz.d, prendaParam.warp(mm, pz.id))
        const nombre = pieceLabelFromId(pz.id, pz.id)
        if (pz.id.startsWith('inner-') || !cortesRef.current.length) {
          out.push({ pz, d, key: pz.id, nombre }); continue
        }
        let trozos = [{ d, key: pz.id, nombre }]
        for (const corte of cortesRef.current) {
          const nuevos: typeof trozos = []
          for (const t of trozos) {
            if (!alcanzaA(corte, t.key)) { nuevos.push(t); continue }
            const partes = partirPoligono(aplanarTrazado(t.d), corte.pts)
            if (!partes) { nuevos.push(t); continue }
            const centro = (q: Punto[]) => q.reduce((a, b) => a + b[1], 0) / q.length
            const ord = centro(partes[0]) <= centro(partes[1]) ? partes : [partes[1], partes[0]]
            ord.forEach((q, i) => nuevos.push({
              d: poligonoAPath(q),
              key: `${t.key}#${i + 1}`,
              nombre: `${t.nombre} · ${i === 0 ? 'arriba' : 'abajo'}`,
            }))
          }
          trozos = nuevos
        }
        for (const t of trozos) out.push({ pz, d: t.d, key: t.key, nombre: t.nombre })
      }
      return out
    }

    const construir = (mm: Medidas) => expandir(mm).map(({ pz, d, key, nombre }) => {
      const esInterior = pz.id.startsWith('inner-')
      const p = new fabric.Path(d, {
        fill: pz.fill, stroke: pz.stroke, strokeWidth: pz.strokeWidth,
        selectable: false, evented: !esInterior,
        hoverCursor: 'crosshair', strokeUniform: true,
      })
      ;(p as any)._rawMockup = true
      ;(p as any)._pieceKey = key
      ;(p as any)._pieceName = nombre
      // De que pieza del molde salio. Al dividir hay mas trazados que piezas,
      // asi que la separacion frente/espalda no puede ir por posicion.
      ;(p as any)._srcId = pz.id
      if (esInterior) { (p as any)._rawInner = true }
      else if (pz.id.startsWith('body')) { (p as any)._rawBody = true }
      return p
    })

    // Separación entre frente y espalda: se mide en el dibujo original y se
    // mantiene siempre. Sin esto, al ensanchar el pecho cada mitad crecía hacia
    // la otra hasta encimarse (la manga del frente se metía en la espalda).
    const esB = prendaParam.segundaMitad
    /** Cuánto hay que correr la segunda mitad para que el hueco no cambie. */
    const correccion = (lista: fabric.Path[]) => {
      if (!esB) return 0
      const a = lista.filter(o => !esB((o as any)._srcId))
      const b = lista.filter(o =>  esB((o as any)._srcId))
      if (!a.length || !b.length) return 0
      const finA = Math.max(...a.map(o => (o.left ?? 0) + (o.width ?? 0)))
      const iniB = Math.min(...b.map(o => o.left ?? 0))
      if (huecoMitadesRef.current === null) { huecoMitadesRef.current = iniB - finA; return 0 }
      return (finA + huecoMitadesRef.current) - iniB
    }
    const aplicarCorreccion = (lista: fabric.Path[], delta: number) => {
      if (!esB || !delta) return
      lista.forEach(o => { if (esB((o as any)._srcId)) o.set({ left: (o.left ?? 0) + delta }) })
    }

    // El hueco se calibra una sola vez, con las medidas por defecto.
    if (huecoMitadesRef.current === null && esB) correccion(construir(prendaParam.defaults))

    const objs = construir(m)
    const deltaB = correccion(objs)
    aplicarCorreccion(objs, deltaB)

    // La pintura se busca por NOMBRE de pieza, no por posicion: al dividir una
    // pieza cambia la cantidad, y comparando posiciones la prenda se despintaba
    // entera de golpe.
    const porNombre = new Map<string, typeof prevPaint[number]>()
    for (const pp of prevPaint) if (pp.key) porNombre.set(pp.key, pp)
    if (prevPaint.length) {
      objs.forEach((o, i) => {
        if ((o as any)._rawInner) return
        const clave = (o as any)._pieceKey as string | undefined
        // Un pedazo recien nacido (`cuerpo#1`) hereda la pintura de la pieza de
        // la que salio, asi dividir no cambia como se ve la prenda.
        const pp = (clave ? porNombre.get(clave) : undefined)
          ?? (clave ? porNombre.get(clave.split('#')[0]) : undefined)
          ?? (prevPaint.length === objs.length ? prevPaint[i] : undefined)
        if (!pp) return
        if (pp.tex)  (o as any)._texture   = pp.tex
        if (pp.eff)  (o as any)._effect    = pp.eff
        if (pp.uTex) (o as any)._userTex   = pp.uTex
        // Sin tela, el color liso que estaba dibujado MANDA sobre la base: los
        // disenos guardados antes de que el balde registrara la base traen las
        // dos cosas desincronizadas, y tocar una medida los devolvia al color
        // viejo en vez de dejar el que se veia en pantalla.
        const colorLiso = !pp.tex && !pp.uTex && typeof pp.fill === 'string' && pp.fill !== ''
        if (colorLiso)    (o as any)._baseColor = pp.fill
        else if (pp.base) (o as any)._baseColor = pp.base
        if ((o as any)._baseColor || pp.tex || pp.eff || pp.uTex) recomposeFill(o)
        else if (typeof pp.fill === 'string' && pp.fill !== '') o.set({ fill: pp.fill })
      })
    }

    if (!prendaFitRef.current) {
      const base = construir(prendaParam.defaults)
      aplicarCorreccion(base, correccion(base))
      const bx = Math.min(...base.map(o => o.left ?? 0))
      const by = Math.min(...base.map(o => o.top  ?? 0))
      const bw = Math.max(...base.map(o => (o.left ?? 0) + (o.width  ?? 0))) - bx
      const bh = Math.max(...base.map(o => (o.top  ?? 0) + (o.height ?? 0))) - by
      const pad = Math.min(CW, CH) * 0.12
      const sc0 = Math.min((CW - pad * 2) / bw, (CH - pad * 2) / bh)
      prendaFitRef.current = { sc: sc0, ox: (CW - bw * sc0) / 2 - bx * sc0, oy: (CH - bh * sc0) / 2 - by * sc0 }
    }
    const { sc, ox, oy } = prendaFitRef.current
    objs.forEach(o => o.set({ left: (o.left ?? 0) * sc + ox, top: (o.top ?? 0) * sc + oy, scaleX: sc, scaleY: sc }))
    objs.forEach(o => canvas.add(o))
    mockupObjects.current = objs
    syncInnerShade()

    // El recorte es la unión de las piezas que se pintan (no el cuello ni los
    // detalles): lo que el diseñador dibuje encima se corta contra la prenda.
    // Se recorre `objs` y no `piezas`: al dividir hay mas trazados que piezas del
    // molde, y emparejandolos por posicion el recorte quedaba corrido.
    const porId = new Map(piezas.map(pz => [pz.id, pz]))
    const clipObjs = objs
      .filter(o => {
        const pz = porId.get((o as any)._srcId as string)
        return !!pz?.fill && !pz.id.startsWith('inner-')
      })
      // Se clona del objeto ya construido y ya corrido: si se rehiciera aparte,
      // el recorte no llevaría la corrección y quedaría movido respecto de la
      // prenda (lo dibujado encima se cortaría en el lugar equivocado).
      .map(obj => {
        const p = new fabric.Path((obj as any).path, { fill: '#000' })
        p.set({ left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY })
        return p
      })
    const cg = new fabric.Group(clipObjs); cg.absolutePositioned = true
    clipPath.current = cg
    pxPerCmRef.current = sc * prendaParam.unidadesPorCm

    for (let i = objs.length - 1; i >= 0; i--) canvas.sendObjectToBack(objs[i])
    if (reassignClip) {
      canvas.getObjects().forEach(o => {
        if (mockupObjects.current.includes(o) || o instanceof fabric.IText) return
        o.clipPath = clipEnabledRef.current ? cg : undefined
        o.dirty = true
      })
    }
    canvas.requestRenderAll()
    encuadrarPrenda()
    refreshLayersNow()
  }

  /** Cambiar una medida del pantalón o la chomba: rehace la prenda. */
  function aplicarMedidas(next: Medidas) {
    const limpio: Medidas = { ...next }
    for (const c of prendaParam?.campos ?? []) {
      const v = limpio[c.key]
      limpio[c.key] = Math.max(c.min, Math.min(c.max, Number.isFinite(v) ? v : (prendaParam?.defaults[c.key] ?? 0)))
    }
    medidasRef.current = limpio
    setMedidas(limpio)
    placePrenda(limpio, true)
  }

  /** Editar un grupo plegado: mueve todas sus medidas a la par. */
  function aplicarGrupoMedidas(keys: string[], valorPrincipal: number) {
    const main = keys[0]
    const anterior = medidasRef.current[main] || 1
    const razon = valorPrincipal / anterior
    const next: Medidas = { ...medidasRef.current }
    for (const k of keys) next[k] = Math.round((k === main ? valorPrincipal : medidasRef.current[k] * razon) * 10) / 10
    aplicarMedidas(next)
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

  // ── Símbolos (sellos) ────────────────────────────────────────────────────
  function saveSymbols(next: { id: string; name: string; json: any }[]) {
    setSymbols(next)
    try { localStorage.setItem('raw.symbols', JSON.stringify(next)) } catch { /* cuota llena */ }
  }
  function createSymbolFromSelection() {
    const canvas = fc.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active || mockupObjects.current.includes(active)) return
    const json = active.toObject()
    const n = symbolsRef.current.length + 1
    const id = 'sym_' + n + '_' + (json.type || 'obj')
    saveSymbols([...symbolsRef.current, { id, name: 'Símbolo ' + n, json }])
    setActiveSymbol(id)
  }
  function deleteSymbol(id: string) {
    const next = symbolsRef.current.filter(s => s.id !== id)
    saveSymbols(next)
    if (activeSymbolRef.current === id) setActiveSymbol(next[0]?.id ?? null)
  }

  // Crea una forma con medidas exactas en la posición del click (diálogo de medidas).
  function createExactShape() {
    const canvas = fc.current
    const d = exactDialog
    if (!canvas || !d) return
    const stroke = colorRef.current
    const sw     = brushSizeRef.current
    // Sin relleno es SIN relleno (ver el mismo criterio al dibujar a mano).
    const fill   = fillRef.current
    const common = { strokeWidth: sw, strokeUniform: true } as const
    const w = Math.max(1, exactW), h = Math.max(1, exactH)
    let shape: fabric.FabricObject
    if (d.tool === 'ellipse') {
      shape = new fabric.Ellipse({ ...common, left: d.sx, top: d.sy, rx: w / 2, ry: h / 2, fill, stroke })
    } else {
      const radius = d.tool === 'rrect' ? Math.min(24, Math.min(w, h) * 0.2) : 0
      shape = new fabric.Rect({ ...common, left: d.sx, top: d.sy, width: w, height: h, rx: radius, ry: radius, fill, stroke })
    }
    if (clipEnabledRef.current && clipPath.current) shape.clipPath = clipPath.current
    shape.setCoords()
    canvas.add(shape)
    undoHistory.current.push({ type: 'add', obj: shape })
    redoHistory.current = []
    canvas.setActiveObject(shape)
    canvas.requestRenderAll()
    setExactDialog(null)
    setTool('select')
  }

  // Reflejar (espejar) lo seleccionado en horizontal o vertical — útil para prendas simétricas.
  function flipSelected(axis: 'x' | 'y') {
    const canvas = fc.current
    if (!canvas) return
    const objs = canvas.getActiveObjects().filter(o => !mockupObjects.current.includes(o))
    if (!objs.length) return
    const key = axis === 'x' ? 'flipX' : 'flipY'
    for (const o of objs) {
      const prev = { [key]: (o as any)[key] ?? false }
      o.set({ [key]: !((o as any)[key] ?? false) } as any)
      o.setCoords()
      undoHistory.current.push({ type: 'props', obj: o, prev })
    }
    redoHistory.current = []
    canvas.requestRenderAll()
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
      escena: canvas.getScenePoint(e.nativeEvent),
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
          <ShapeToolGroup tool={tool} setTool={setTool} />
          <ToolDivider />
          <ToolBtn icon={<IconBucket />} label="Relleno (K)"      active={tool === 'fill'}        onClick={() => setTool('fill')} />
          <ToolBtn icon={<IconEyedropper />} label="Gotero (I)"   active={tool === 'eyedropper'} onClick={() => setTool('eyedropper')} />
          <ToolBtn icon={<IconEraser />} label="Goma (Shift+E)"   active={tool === 'eraser'} onClick={() => setTool('eraser')} />
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

          {/* Gotero: lupa con los píxeles de alrededor y el color del centro.
              Se ve con solo pasar el mouse, antes de tocar nada, así se puede
              apuntar al píxel exacto en vez de clickear a ciegas. */}
          <div style={{
            position: 'absolute',
            left: (eyeProbe?.x ?? 0) + 20, top: (eyeProbe?.y ?? 0) + 20,
            zIndex: 45, pointerEvents: 'none',
            visibility: eyeProbe ? 'visible' : 'hidden',
            display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0,
            borderRadius: 10, overflow: 'hidden',
            background: 'rgb(0 0 0 / 0.78)', border: '1px solid rgb(255 255 255 / 0.22)',
            boxShadow: '0 6px 18px rgb(0 0 0 / 0.45)',
          }}>
            <canvas ref={loupeRef} width={110} height={110}
              style={{ display: 'block', width: 110, height: 110 }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px',
              borderTop: '1px solid rgb(255 255 255 / 0.18)',
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                background: eyeProbe?.hex ?? '#000',
                border: '1px solid rgb(255 255 255 / 0.5)',
              }} />
              <span className="mono" style={{ fontSize: 11, color: '#fff', letterSpacing: '.02em' }}>
                {eyeProbe?.hex ?? ''}
              </span>
            </div>
          </div>

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
              {tool === 'pen'   && 'Click · agregar  |  Alt+arrastrar · ángulo libre  |  Ctrl+Z · borrar el último punto  |  Supr · eliminar ancla  |  Enter · terminar'}
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
                onClick={centrarPrenda}
                style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 11 }}
              >
                ⊕  Centrar prenda
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { measuresRef.current = DEFAULT_MEASURES; setMeasures(DEFAULT_MEASURES); placeTee(DEFAULT_MEASURES, true) }}
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 11 }}
              >
                Restablecer medidas
              </button>
            </div>
            )
          })()}
          {/* Medidas del pantalón y de la chomba. Mismo panel que la remera, con
              las medidas que corresponden a cada prenda. */}
          {prendaParam && !hasSel && (() => {
            const cmInput = (val: number, min: number, max: number, onCh: (v: number) => void) => (
              <div onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                <NumberField value={val} onChange={onCh} min={min} max={max} step={0.5} suffix="cm" width={60} />
              </div>
            )
            const campo = (k: string) => prendaParam.campos.find(c => c.key === k)!
            return (
              <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
                <div className="label" style={{ marginBottom: 8 }}>Medidas de la prenda (cm)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {prendaParam.grupos.map(g => {
                    const unica = g.keys.length === 1
                    const open  = !!openGroups[g.id]
                    const main  = campo(g.keys[0])
                    return (
                      <div key={g.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 8, overflow: 'hidden' }}>
                        <div
                          onClick={() => { if (!unica) setOpenGroups(p => ({ ...p, [g.id]: !p[g.id] })) }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                            cursor: unica ? 'default' : 'pointer', background: 'var(--surface)' }}
                        >
                          {!unica && <span style={{ fontSize: 9, width: 10, transition: 'transform 0.15s', transform: open ? 'none' : 'rotate(-90deg)' }}>▾</span>}
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--ui)' }}>{g.label}</span>
                          {(unica || !open) && cmInput(medidas[g.keys[0]], main.min, main.max,
                            v => unica ? aplicarMedidas({ ...medidasRef.current, [g.keys[0]]: v })
                                       : aplicarGrupoMedidas(g.keys, v))}
                        </div>
                        {!unica && open && (
                          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {g.keys.map(k => {
                              const f = campo(k)
                              return (
                                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--ui)' }}>{f.label}</span>
                                  {cmInput(medidas[k], f.min, f.max, v => aplicarMedidas({ ...medidasRef.current, [k]: v }))}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button className="btn btn-ghost" onClick={centrarPrenda}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 11 }}>
                  ⊕  Centrar prenda
                </button>
                <button className="btn btn-ghost"
                  onClick={() => aplicarMedidas({ ...prendaParam.defaults })}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 11 }}>
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
              {/* Reflejar (espejar) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
                <span className="label">Reflejar</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost" title="Reflejar horizontal (Shift+H)" onClick={() => flipSelected('x')}
                    style={{ padding: '4px 10px', fontSize: 11 }}>⇆ H</button>
                  <button className="btn btn-ghost" title="Reflejar vertical (Shift+V)" onClick={() => flipSelected('y')}
                    style={{ padding: '4px 10px', fontSize: 11 }}>⇅ V</button>
                </div>
              </div>
              {/* Opacidad */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="label">Opacidad</span>
                  <NumberField value={propOpacity} onChange={applyOpacity} step={1} min={0} max={100} suffix="%" />
                </div>
                <input className="raw-range" type="range" min={0} max={100} step={1} value={propOpacity}
                  onChange={e => applyOpacity(Number(e.target.value))}
                  style={{ ['--fill' as string]: `${propOpacity}%` }} />
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

          {/* Opciones de polígono / estrella (al estilo Illustrator) */}
          {(tool === 'polygon' || tool === 'star') && (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>{tool === 'star' ? 'Estrella' : 'Polígono'}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="label">{tool === 'star' ? 'Puntas' : 'Lados'}</span>
                {tool === 'star'
                  ? <NumberField value={starPointCount} onChange={v => setStarPointCount(Math.max(3, Math.min(20, Math.round(v))))} min={3} max={20} step={1} />
                  : <NumberField value={polySides} onChange={v => setPolySides(Math.max(3, Math.min(20, Math.round(v))))} min={3} max={20} step={1} />}
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 7, lineHeight: 1.4 }}>
                Arrastrá desde el centro hacia afuera para dibujar.
              </p>
            </div>
          )}

          {/* Símbolos (sellos) */}
          {tool === 'symbol' && (
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
              <div className="label" style={{ marginBottom: 8 }}>Símbolos</div>
              <button className="btn btn-ghost" onClick={createSymbolFromSelection}
                style={{ width: '100%', padding: '6px 10px', fontSize: 11, marginBottom: 8 }}>
                + Crear desde la selección
              </button>
              {symbols.length === 0 ? (
                <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Seleccioná un objeto y creá un símbolo. Después clickeá en el lienzo para estampar copias.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {symbols.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setActiveSymbol(s.id)} style={{
                        flex: 1, textAlign: 'left', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                        background: activeSymbol === s.id ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
                        border: '1px solid ' + (activeSymbol === s.id ? 'var(--accent)' : 'var(--line)'),
                        color: activeSymbol === s.id ? 'var(--accent)' : 'var(--fg-2)', fontFamily: 'var(--ui)',
                      }}>{s.name}</button>
                      <button onClick={() => deleteSymbol(s.id)} title="Eliminar símbolo" style={{
                        background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: 4,
                      }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {activeSymbol && symbols.length > 0 && (
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.4 }}>
                  Clickeá en el lienzo para estampar el símbolo activo.
                </p>
              )}
            </div>
          )}

          {/* Relleno */}
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Relleno</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {propFill !== null ? (
                <>
                  <ColorPicker value={propFill} onChange={applyFill} title="Color de relleno" />
                  <span className="mono" style={{ fontSize: 11, flex: 1, color: 'var(--fg-2)' }}>{propFill}</span>
                  <PickColorBtn title="Tomar un color de la pantalla"
                    onPick={applyFill} onFallback={() => setTool('eyedropper')} />
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
              <ColorPicker value={propStroke} onChange={applyStroke} title="Color del trazado" />
              <span className="mono" style={{ fontSize: 11, flex: 1, color: 'var(--fg-2)' }}>{propStroke}</span>
              <PickColorBtn title="Tomar un color de la pantalla"
                onPick={applyStroke} onFallback={() => setTool('eyedropper')} />
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
                  { id: 'costura',  label: 'Costura', icon: <StrokeStyleIcon kind="costura" /> },
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
                  Dibujá con el lápiz o la pluma y el trazo se reemplaza por {
                    strokeStyle === 'bordado' ? 'puntadas de bordado'
                    : strokeStyle === 'cierre' ? 'un cierre'
                    : 'una línea de costura'}.
                </p>
              )}
            </div>
          </div>

          {/* Pasar a bordado: un dibujo, una figura o un texto → hilo de verdad */}
          <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--line-soft)' }}>
            <div className="label" style={{ marginBottom: 6 }}>Bordado</div>
            <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 9, lineHeight: 1.45 }}>
              Convierte lo seleccionado en bordado. Toma el color del objeto como
              color del hilo. Queda como imagen: el hilo ya no se edita como vector.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <span className="label">Dirección del hilo</span>
              <NumberField value={bordadoAngulo} onChange={v => setBordadoAngulo(Math.max(0, Math.min(180, Math.round(v))))}
                min={0} max={180} step={5} suffix="°" />
            </div>
            <button className="btn btn-primary btn-block"
              disabled={!hasSel || bordando}
              onClick={convertirEnBordado}
              style={{ opacity: (!hasSel || bordando) ? 0.5 : 1, cursor: (!hasSel || bordando) ? 'default' : 'pointer' }}>
              {bordando ? 'Bordando…' : 'Convertir en bordado'}
            </button>
            {!hasSel && (
              <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 7 }}>
                Seleccioná primero un dibujo, una figura o un texto.
              </p>
            )}
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

              {/* ── Telas, todas juntas ───────────────────────────────────────
                  Antes estaban repartidas en tres listas (los estampados que
                  genera el programa, las telas que vienen con él y las que
                  importa el diseñador). Eran tres grillas separadas para lo
                  mismo: elegir con qué está hecha la prenda. Ahora es una sola,
                  en el orden en que se usan. Lo que cambia de cada clase —los
                  colores del estampado, el ancho de la muestra— aparece abajo
                  cuando hay una elegida. */}
              <div className="label" style={{ marginBottom: 4 }}>Telas</div>
              <p className="sec-hint">
                Las telas con foto se aplican a escala real; los estampados se
                pueden recolorear.
              </p>
              <div key={paletteVersion} className="swatches">
                {/* Estampados que dibuja el programa: se recolorean */}
                {TEXTURES.map(t => {
                  const on = activeTexKind === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => applyTexture(t.id)}
                      title={`${t.label} · se puede cambiar de color`}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 5, padding: 0,
                        background: 'none', border: 'none', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '1', borderRadius: 8,
                        backgroundImage: `url(${makeTextureCanvas(t.id, texColors[t.id]).toDataURL()})`,
                        backgroundSize: '56px 56px',
                        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                        outline: on ? '1px solid var(--accent)' : 'none',
                      }} />
                      <span style={{
                        fontSize: 10, color: on ? 'var(--accent)' : 'var(--fg-2)',
                        fontFamily: 'var(--ui)', textAlign: 'center',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{t.label}</span>
                    </button>
                  )
                })}

                {/* Telas de verdad: las que vienen con el programa primero y las
                    importadas después, que es el orden en que se buscan. Solo
                    las importadas se pueden borrar. */}
                {[...userTextures.filter(t => t.builtIn), ...userTextures.filter(t => !t.builtIn)].map(t => {
                  const on = activeUserTex === t.id
                  // Si la tela ya se usó, la miniatura sale de la imagen que está
                  // en memoria, que es la que tiene los colores elegidos. Si no,
                  // la versión chica: abrir esta pestaña no tiene por qué bajar
                  // los archivos grandes.
                  const thumb = userTexImages.current.get(t.id)?.src
                    ?? (t.builtIn ? rawTextureById(t.id)?.thumb : undefined)
                    ?? t.dataUrl
                  return (
                    <div key={t.id} style={{ position: 'relative' }}>
                      <button
                        onClick={() => applyUserTexture(t)}
                        title={`${t.name} · muestra de ${t.widthCm} cm`}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 5, padding: 0,
                          background: 'none', border: 'none', cursor: 'pointer', width: '100%',
                        }}
                      >
                        <div style={{
                          width: '100%', aspectRatio: '1', borderRadius: 8,
                          backgroundImage: `url("${thumb}")`, backgroundSize: 'cover',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                          outline: on ? '1px solid var(--accent)' : 'none',
                        }} />
                        <span style={{
                          fontSize: 10, color: on ? 'var(--accent)' : 'var(--fg-2)',
                          fontFamily: 'var(--ui)', textAlign: 'center',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{t.name}</span>
                      </button>
                      {!t.builtIn && (
                        <span
                          role="button"
                          title="Eliminar de mi biblioteca"
                          onClick={e => { e.stopPropagation(); handleTextureDelete(t.id) }}
                          style={{
                            position: 'absolute', top: 4, right: 4, width: 18, height: 18,
                            borderRadius: '50%', cursor: 'pointer', fontSize: 10,
                            background: 'rgb(0 0 0 / 0.55)', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >✕</span>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                onClick={() => texFileRef.current?.click()}
                disabled={texImporting}
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'center', fontSize: 11.5, margin: '10px 0 2px' }}
              >
                {texImporting ? 'Importando…' : '+  Importar mi tela'}
              </button>
              {texError && (
                <div style={{
                  fontSize: 10.5, color: 'var(--danger)', lineHeight: 1.4, marginTop: 8,
                  padding: '7px 9px', borderRadius: 6,
                  background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--danger) 28%, transparent)',
                }}>{texError}</div>
              )}
              {/* Editor de colores de la textura aplicada */}
              {activeTexKind && (
                <div className="sec">
                  <div className="label" style={{ marginBottom: 10 }}>
                    Color · {TEXTURES.find(t => t.id === activeTexKind)?.label}
                  </div>

                  {/* Color principal (los demás se ajustan solos) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <ColorPicker
                      value={texColors[activeTexKind][TEX_PRIMARY[activeTexKind]]}
                      onChange={c => setTexPrimary(activeTexKind, c)}
                      title="Color principal de la tela" />
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
                              <ColorPicker
                                value={texColors[activeTexKind][i]}
                                onChange={c => updateTexColor(activeTexKind, i, c)}
                                size={26} title={slot.label} />
                              <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>{slot.label}</span>
                              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{texColors[activeTexKind][i]}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <button onClick={() => resetTexColors(activeTexKind)}
                    className="btn btn-ghost btn-block" style={{ marginTop: 8 }}>
                    Restablecer colores
                  </button>
                </div>
              )}

              {/* ── Color de una tela de fábrica ─────────────────────────────
                  Un SVG trae los colores adentro, así que se editan uno por
                  uno. Una foto no: se reteñe entera desde un solo color. */}
              {activeUserTex && isRawTexture(activeUserTex) && (() => {
                const def = rawTextureById(activeUserTex)
                const src = rawSource.current.get(activeUserTex)
                if (!def || !src) return null
                const cur = rawPalettes.current[activeUserTex] ?? src.colors
                const tocada = !sameColors(cur, src.colors)
                const porColor = def.kind === 'svg' && src.colors.length > 1

                return (
                  <div key={paletteVersion} className="sec">
                    <div className="label" style={{ marginBottom: 10 }}>Color · {def.name}</div>

                    {/* Color principal: el que más tela ocupa. Al cambiarlo, el
                        resto de los hilos lo acompañan, así el tartán sigue
                        siendo el mismo tartán en otro color. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <ColorPicker
                        value={cur[0]}
                        onChange={c => setRawPalette(activeUserTex, shiftPalette(src.colors, 0, c))}
                        title="Color principal de la tela" />
                      <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>Color principal</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{cur[0]}</span>
                    </div>

                    {porColor && (
                      <>
                        <button onClick={() => setTexAdvanced(v => !v)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none',
                            color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: '6px 0', fontFamily: 'var(--ui)' }}>
                          <span style={{ display: 'inline-block', transform: texAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
                          Opciones avanzadas
                        </button>
                        {texAdvanced && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4, marginTop: 2 }}>
                            {src.colors.map((_, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ColorPicker
                                  value={cur[i]}
                                  onChange={c => {
                                    const next = [...cur]
                                    next[i] = c
                                    setRawPalette(activeUserTex, next)
                                  }}
                                  size={26} />
                                <span style={{ fontSize: 12, color: 'var(--fg-2)', flex: 1 }}>
                                  {i === 0 ? 'Color principal' : `Color ${i + 1}`}
                                </span>
                                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{cur[i]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {def.kind === 'photo' && (
                      <p className="sec-hint">
                        Es una foto, así que se tiñe entera desde un solo color. Los negros
                        y los blancos no se mueven.
                      </p>
                    )}

                    {tocada && (
                      <button onClick={() => setRawPalette(activeUserTex, null)}
                        className="btn btn-ghost btn-block" style={{ marginTop: 8 }}>
                        Volver al color original
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* Escala real: lo que separa esto de "insertar una imagen".
                  Vale para las dos bibliotecas, las de fábrica y las propias,
                  por eso vive fuera de ambas. */}
              {activeUserTex && (() => {
                const t = userTextures.find(x => x.id === activeUserTex)
                if (!t) return null
                return (
                  <div className="sec">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="label">Ancho real · {t.name}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{t.widthCm} cm</span>
                    </div>
                    <input
                      className="raw-range"
                      type="range" min={2} max={80} value={t.widthCm}
                      onChange={e => setUserTexScale(t.id, Number(e.target.value))}
                      style={{ marginTop: 4, ['--fill' as string]: `${((t.widthCm - 2) / 78) * 100}%` }}
                    />
                    <p className="sec-hint">
                      Cuánto mide en la realidad el ancho de la muestra. Ajustalo para que
                      el estampado quede del tamaño correcto sobre la prenda.
                    </p>
                  </div>
                )
              })()}

              {/* ── Efectos de tela ──────────────────────────────────────────
                  Van ENCIMA del color o del estampado, no lo reemplazan:
                  denim + desgaste = jean gastado. */}
              <div className="sec">
                <div className="label" style={{ marginBottom: 4 }}>Efectos de tela</div>
                <p className="sec-hint">
                  Se suman al color o estampado que ya tenga la prenda.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                  {/* "Ninguno" siempre visible: quitar el efecto no debería
                      depender de que primero haya uno aplicado. */}
                  <button
                    onClick={removeEffect}
                    title="Sin efecto de tela"
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      padding: '8px 4px', borderRadius: 7, cursor: 'pointer',
                      background: !activeEffect ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
                      border: '1px solid ' + (!activeEffect ? 'var(--accent)' : 'var(--line)'),
                      color: !activeEffect ? 'var(--accent)' : 'var(--fg-2)',
                      transition: 'all 0.15s var(--ease)',
                    }}
                  >
                    <span style={{
                      width: '100%', height: 26, borderRadius: 4,
                      border: '1px solid var(--line-soft)',
                      display: 'grid', placeItems: 'center',
                      fontSize: 13, color: 'var(--muted)',
                    }}>⃠</span>
                    <span style={{ fontSize: 9.5, fontFamily: 'var(--ui)' }}>Ninguno</span>
                  </button>

                  {EFFECTS.map(e => {
                    const on = activeEffect === e.id
                    return (
                      <button
                        key={e.id}
                        onClick={() => applyEffect(e.id, effectIntensity)}
                        title={e.hint}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                          padding: '8px 4px', borderRadius: 7, cursor: 'pointer',
                          background: on ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface)',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                          color: on ? 'var(--accent)' : 'var(--fg-2)',
                          transition: 'all 0.15s var(--ease)',
                        }}
                      >
                        <span style={{
                          width: '100%', height: 26, borderRadius: 4,
                          backgroundImage: `url(${effectPreview(e.id, effectIntensity)})`,
                          backgroundSize: 'cover',
                          border: '1px solid var(--line-soft)',
                        }} />
                        <span style={{ fontSize: 9.5, fontFamily: 'var(--ui)' }}>{e.label}</span>
                      </button>
                    )
                  })}
                </div>

                {activeEffect && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                      <span className="label">Intensidad</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {Math.round(effectIntensity * 100)}%
                      </span>
                    </div>
                    <input
                      className="raw-range"
                      type="range" min={0} max={100} value={Math.round(effectIntensity * 100)}
                      onChange={e => {
                        const v = Number(e.target.value) / 100
                        setEffectIntensity(v)
                        applyEffect(activeEffect, v)
                      }}
                      style={{ marginTop: 4, ['--fill' as string]: `${Math.round(effectIntensity * 100)}%` }}
                    />
                  </>
                )}
              </div>
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

      {/* Input oculto para importar texturas propias */}
      <input
        ref={texFileRef}
        type="file"
        accept={TEXTURE_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleTextureUpload}
      />

      {/* Menú contextual (click derecho) */}
      {/* Diálogo de medidas exactas (click sin arrastrar con una forma) */}
      {exactDialog && (
        <>
          <div onClick={() => setExactDialog(null)} style={{ position: 'fixed', inset: 0, zIndex: 320 }} />
          <div style={{
            position: 'fixed', zIndex: 321,
            left: Math.min(exactDialog.px, window.innerWidth - 230),
            top: Math.min(exactDialog.py, window.innerHeight - 150),
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
            padding: 12, boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--ui)', width: 210,
          }}
            onKeyDown={e => { if (e.key === 'Enter') createExactShape(); if (e.key === 'Escape') setExactDialog(null) }}>
            <div className="label" style={{ marginBottom: 8 }}>
              Medidas {exactDialog.tool === 'ellipse' ? '(elipse)' : exactDialog.tool === 'rrect' ? '(redondeado)' : '(rectángulo)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ancho</div>
                <NumberField value={exactW} onChange={v => setExactW(Math.max(1, Math.round(v)))} min={1} step={1} fullWidth />
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Alto</div>
                <NumberField value={exactH} onChange={v => setExactH(Math.max(1, Math.round(v)))} min={1} step={1} fullWidth />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setExactDialog(null)} style={{ padding: '5px 12px', fontSize: 12 }}>Cancelar</button>
              <button className="btn btn-primary" onClick={createExactShape} style={{ padding: '5px 12px', fontSize: 12 }}>Crear</button>
            </div>
          </div>
        </>
      )}

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

              {/* Dividir con este trazo: solo aparece si el trazo cruza alguna
                  pieza de lado a lado, o sea si de verdad la parte en dos. */}
              {(() => {
                // El trazo puede ser el objeto seleccionado o simplemente el que
                // pasa por donde se hizo clic derecho.
                const trazo = (t && !mockupObjects.current.includes(t) && !((t as any)._garmentGroup))
                  ? t : trazoEn(ctxMenu.escena)
                if (!trazo) return null
                const corte = trazoDivide(trazo)
                if (!corte) return null
                // Si el trazo cruza varias piezas hay que preguntar el alcance:
                // no es lo mismo partir toda la remera que solo el cuerpo.
                const varias = piezasQueDivide(corte).length > 1
                const pieza = varias ? piezaEn(ctxMenu.escena) : null
                const keyPieza = pieza ? (pieza as any)._pieceKey as string | undefined : undefined
                return (
                  <>
                    <CtxDivider />
                    <CtxItem label={varias ? 'Dividir toda la prenda acá' : 'Dividir la prenda acá'}
                      hint="para pintar cada lado"
                      onClick={() => { dividirPrendaCon(trazo); closeCtx() }} />
                    {varias && keyPieza && (
                      <CtxItem label={`Dividir solo ${(pieza as any)._pieceName ?? 'esta pieza'}`}
                        hint="el resto queda entero"
                        onClick={() => { dividirPrendaCon(trazo, keyPieza); closeCtx() }} />
                    )}
                  </>
                )
              })()}
              {hayCortes && (
                <>
                  <CtxDivider />
                  <CtxItem label="Quitar las divisiones" onClick={() => { quitarCortes(); closeCtx() }} />
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
// Quedaron las dos que valen como tela: rayas y denim. Cuadrillé, lunares,
// camuflado y animal print eran dibujitos planos que no leían como género y
// ensuciaban el panel. Las telas de verdad van por "Telas RAW" (fotos).
type TextureKind = 'rayas' | 'denim'

const TEXTURES: { id: TextureKind; label: string }[] = [
  { id: 'rayas', label: 'Rayas' },
  { id: 'denim', label: 'Denim' },
]

// Slots de color editables por textura (color principal = primero, secundario = segundo, etc.)
const TEXTURE_COLORS: Record<TextureKind, { label: string; def: string }[]> = {
  rayas: [{ label: 'Fondo', def: '#f4f1e8' }, { label: 'Rayas', def: '#2b3a67' }],
  denim: [{ label: 'Base', def: '#3b5b8c' }],
}
const defaultTexPalette = (k: TextureKind) => TEXTURE_COLORS[k].map(c => c.def)

// Un diseño guardado puede traer una textura que ya no existe (cuadrillé,
// lunares, camuflado, animal). Se ignora y la pieza queda con su color liso,
// en vez de abrir el proyecto roto o pintado de cualquier cosa.
const esTexturaValida = (k: unknown): k is TextureKind =>
  k === 'rayas' || k === 'denim'

// ── Efectos de tela (grunge / vintage / desgaste) ────────────────────────────
// A diferencia de los estampados, un efecto NO reemplaza el relleno: se dibuja
// ENCIMA de lo que ya hay (color liso o estampado). Por eso se combinan:
// denim + desgaste = jean gastado.
type EffectKind = 'grunge' | 'vintage' | 'desgaste'

const EFFECTS: { id: EffectKind; label: string; hint: string }[] = [
  { id: 'desgaste', label: 'Desgaste', hint: 'Zonas donde la tela se gastó' },
  { id: 'grunge',   label: 'Grunge',   hint: 'Manchas y suciedad irregular' },
  { id: 'vintage',  label: 'Vintage',  hint: 'Tono envejecido y desvaído' },
]

// El tile del efecto es múltiplo del tile de estampado (56) para que el
// estampado de abajo no se corte en la unión al repetirse.
const EFFECT_TILE = 168   // 56 × 3

// Miniatura del efecto para el panel: se dibuja sobre un gris neutro para que
// se vea el efecto en sí y no el color de la prenda. Cacheada por kind+intensidad.
const effectPreviewCache = new Map<string, string>()
function effectPreview(kind: EffectKind, intensity: number): string {
  const key = `${kind}:${Math.round(intensity * 10)}`
  const hit = effectPreviewCache.get(key)
  if (hit) return hit
  const s = EFFECT_TILE
  const c = document.createElement('canvas'); c.width = s; c.height = s
  const x = c.getContext('2d')!
  x.fillStyle = '#b9b9b9'; x.fillRect(0, 0, s, s)
  paintEffect(x, kind, Math.max(0, Math.min(1, intensity)), s)
  const url = c.toDataURL()
  effectPreviewCache.set(key, url)
  return url
}

// Dibuja el desgaste sobre el contexto ya pintado con la base.
// `amount` 0..1 controla la intensidad.
function paintEffect(x: CanvasRenderingContext2D, kind: EffectKind, amount: number, s: number): void {
  const rnd = (seed: number) => { const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v) }
  x.save()

  if (kind === 'desgaste') {
    // Una tela NO se gasta en rayas cruzadas al azar. Eso era lo que estaba
    // antes —trazos claros y oscuros en diagonales random, más ruido de un
    // píxel— y leía como plástico arrugado, tipo bolsa ziploc, no como género.
    //
    // El desgaste de verdad tiene dos cosas, y las dos siguen al TEJIDO:
    //   1. el color se va de a manchones suaves, sin bordes;
    //   2. donde el hilo se pela aparece el alma clara, en trazos cortos
    //      alineados a la trama y la urdimbre (horizontales y verticales).

    // 1) Pérdida de color: manchones suaves. Se hace pixel a pixel con ondas de
    //    período entero sobre el tile, así el degradé CIERRA al repetirse y no
    //    aparece la cuadrícula de la unión.
    // Cuánto está rozada la tela en cada punto, de 0 (intacta) a 1 (pelada).
    // Es UNA sola función para las dos capas: así los hilos pelados caen donde
    // la tela ya perdió color, que es lo que pasa de verdad. Repartidos parejo
    // por toda la prenda se leían como ruido tirado encima.
    //
    // Las ondas tienen período entero sobre el tile, así el degradé CIERRA al
    // repetirse y no aparece la cuadrícula de la unión.
    const TAU = Math.PI * 2
    const roce = (u: number, v: number) => Math.max(0, (
      Math.sin(TAU * (u + 0.13)) * Math.cos(TAU * (v + 0.41)) +
      0.6 * Math.sin(TAU * (2 * u - v + 0.27)) +
      0.4 * Math.cos(TAU * (3 * u + 2 * v + 0.66))
    ) / 2)

    // 1) Pérdida de color: manchones suaves, sin bordes.
    // Leer los píxeles puede fallar si la tela vino de una imagen de otro
    // dominio (el navegador lo prohíbe). En ese caso se saltea el manchado y
    // quedan los hilos pelados, en vez de romperse y dejar la prenda sin pintar.
    const lado = Math.max(1, Math.round(s))
    let img: ImageData | null = null
    try { img = x.getImageData(0, 0, lado, lado) } catch { img = null }
    if (img) {
      const d = img.data
      for (let py = 0; py < lado; py++) {
        const v = py / lado
        for (let px = 0; px < lado; px++) {
          const gasto = roce(px / lado, v) * amount * 0.55
          if (gasto <= 0.001) continue
          const i = (py * lado + px) * 4
          // Perder tinte lleva al gris del hilo crudo, no al blanco puro: por
          // eso se ve igual sobre una prenda negra que sobre una clara.
          d[i]     += (214 - d[i])     * gasto
          d[i + 1] += (210 - d[i + 1]) * gasto
          d[i + 2] += (203 - d[i + 2]) * gasto
        }
      }
      x.putImageData(img, 0, 0)
    }

    // 2) Hilos pelados, siguiendo la trama. Cada trazo se dibuja también
    //    corrido un tile hacia atrás, para que el que se pasa del borde entre
    //    por el otro lado y la repetición no se note.
    x.globalCompositeOperation = 'source-over'
    x.lineCap = 'round'
    for (let i = 0; i < Math.round(420 * amount); i++) {
      const px = rnd(i + 11) * s, py = rnd(i + 29) * s
      // Solo donde ya hay roce, y con más densidad cuanto más gastado está.
      const z = roce(px / s, py / s)
      if (z < 0.15 || rnd(i + 97) > z) continue
      // Se pela sobre todo la trama (horizontal). Antes salía mitad y mitad y
      // los cruces formaban crucecitas que no existen en una tela gastada.
      const horizontal = rnd(i + 71) > 0.22
      const len = 3 + rnd(i + 5) * 13
      const claro = rnd(i + 43) > 0.25
      x.strokeStyle = claro
        ? `rgba(228,224,216,${(0.10 + rnd(i + 2) * 0.24) * amount * z})`
        : `rgba(118,111,102,${(0.04 + rnd(i + 3) * 0.10) * amount * z})`
      x.lineWidth = 0.6 + rnd(i + 13) * 0.7
      const dx = horizontal ? len : 0
      const dy = horizontal ? 0   : len
      for (const [ox, oy] of [[0, 0], [-s, 0], [0, -s]]) {
        x.beginPath()
        x.moveTo(px + ox, py + oy)
        x.lineTo(px + ox + dx, py + oy + dy)
        x.stroke()
      }
    }

  } else if (kind === 'grunge') {
    // Moteado sucio: muchas manchas CHICAS y débiles superpuestas. Pocas manchas
    // grandes se notarían como patrón repetido al tilear; muchas chicas leen
    // como suciedad y disimulan la repetición.
    x.globalCompositeOperation = 'multiply'
    for (let i = 0; i < Math.round(70 * amount); i++) {
      const cx = rnd(i + 11) * s, cy = rnd(i + 23) * s, r = 4 + rnd(i + 37) * 13
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, `rgba(70,60,48,${0.16 * amount})`)
      g.addColorStop(1, 'rgba(70,60,48,0)')
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill()
    }
    for (let i = 0; i < Math.round(1600 * amount); i++) {
      const px = rnd(i + 101) * s, py = rnd(i + 211) * s
      x.fillStyle = `rgba(40,35,30,${0.05 + rnd(i + 5) * 0.22 * amount})`
      x.fillRect(px, py, 1, 1)
    }

  } else {
    // vintage: baño cálido + desvaído general + grano fino.
    x.globalCompositeOperation = 'multiply'
    x.fillStyle = `rgba(196,158,106,${0.34 * amount})`   // sepia
    x.fillRect(0, 0, s, s)
    x.globalCompositeOperation = 'screen'                 // lava el contraste
    x.fillStyle = `rgba(255,246,224,${0.20 * amount})`
    x.fillRect(0, 0, s, s)
    x.globalCompositeOperation = 'source-over'
    for (let i = 0; i < Math.round(1100 * amount); i++) {
      const px = rnd(i + 303) * s, py = rnd(i + 407) * s
      const dark = rnd(i + 13) > 0.5
      x.fillStyle = dark ? `rgba(120,100,70,${0.10 * amount})` : `rgba(255,250,235,${0.12 * amount})`
      x.fillRect(px, py, 1, 1)
    }
  }

  x.restore()
}

// ── Bordado ──────────────────────────────────────────────────────────────────
// Convierte la silueta de un vector o un texto en bordado de verdad: hilo sobre
// hilo, no un filtro encima del dibujo.
//
// Lo que hace que se lea como bordado y no como "relleno con rayitas":
//   · las puntadas son CORTAS y van todas en la misma dirección (como sale de
//     una máquina), no un degradé ni un ruido;
//   · cada puntada tiene brillo arriba y sombra abajo, porque el hilo es un
//     cilindro y la luz le pega de un lado;
//   · las uniones entre puntadas van trabadas fila a fila (si quedaran
//     alineadas se verían canaletas, que es el error clásico);
//   · el conjunto está levantado de la tela: sombra abajo y borde propio.
//
// La separación está elegida para que se VEA. A escala real una puntada mide
// menos de medio milímetro: en pantalla no existiría.

/** Resolución interna del bordado (el doble, para que el hilo no salga dentado). */
const BORDADO_MULT = 2
const BORDADO_MARGEN = 10    // lugar para la sombra y el relieve
// La separación y el largo de puntada NO son fijos: se calculan según el tamaño
// del objeto, adentro de renderBordado. Ver ahí el porqué.

/**
 * `silueta` es el objeto ya dibujado (con su color) sobre un canvas.
 * Devuelve un canvas más grande (por el margen) con el bordado.
 */
/**
 * Cualquier color de CSS → `#rrggbb`.
 *
 * Los objetos del lienzo no guardan el color en un formato solo: un texto llega
 * como `rgb(0,0,0)` y una figura como `#ff0000`. Las cuentas de color trabajan
 * con hex, y al pasarles `rgb(...)` devolvían NaN: el bordado salía invisible.
 */
function aHex(color: string): string {
  const c = document.createElement('canvas'); c.width = c.height = 1
  const x = c.getContext('2d')
  if (!x) return '#000000'
  x.fillStyle = '#000000'
  try { x.fillStyle = color } catch { /* color inválido: queda el negro */ }
  const v = String(x.fillStyle)
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  const n = v.match(/[\d.]+/g)
  if (n && n.length >= 3) {
    return '#' + n.slice(0, 3)
      .map(t => Math.max(0, Math.min(255, Math.round(Number(t)))).toString(16).padStart(2, '0'))
      .join('')
  }
  return '#000000'
}

function renderBordado(silueta: HTMLCanvasElement, hiloCrudo: string, anguloGrados: number): HTMLCanvasElement {
  const hilo = aHex(hiloCrudo)
  const w = silueta.width, h = silueta.height
  const M = BORDADO_MARGEN
  const out = document.createElement('canvas')
  out.width = w + M * 2; out.height = h + M * 2
  const o = out.getContext('2d')!

  // Máscara: qué píxeles son parte del dibujo.
  const sctx = silueta.getContext('2d')!
  let datos: Uint8ClampedArray
  try { datos = sctx.getImageData(0, 0, w, h).data } catch { return out }
  const dentro = (px: number, py: number) => {
    const ix = Math.round(px), iy = Math.round(py)
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false
    return datos[(iy * w + ix) * 4 + 3] > 70
  }

  // El brillo y la sombra del hilo se calculan CONTRA el color, no con una
  // cantidad fija: con hilo negro, restarle luz no hace nada y el bordado
  // quedaba un manchón plano. Con hilo blanco pasa lo mismo al revés.
  const [hh, ss, ll] = hexToHsl(hilo)
  const claro  = hslToHex(hh, ss * 0.85, clamp01(ll + (ll > 0.55 ? 0.13 : 0.28)))
  const oscuro = hslToHex(hh, Math.min(1, ss * 1.15), clamp01(ll - (ll < 0.30 ? 0.09 : 0.22)))
  const fondo  = hslToHex(hh, ss, clamp01(ll - (ll < 0.25 ? 0.03 : 0.12)))

  // Tamaño de puntada. Se adapta al objeto: en algo chico una puntada fija
  // quedaba por debajo del píxel y no se veía nada; en algo grande quedaba
  // ridículamente fina. El techo y el piso evitan los dos extremos.
  const escala = ((silueta as any)._mult as number) || 1
  const PASO  = Math.max(3 * escala, Math.min(9 * escala, Math.min(w, h) / 16))
  const LARGO = PASO * 3.5
  const rnd = (n: number) => { const v = Math.sin(n * 91.7 + 13.3) * 43758.5453; return v - Math.floor(v) }

  // 1) Sombra: el bordado tiene espesor y se despega de la tela.
  o.save()
  o.globalAlpha = 0.34
  o.filter = 'blur(3px)'
  o.drawImage(silueta, M + 1.5, M + 3)
  o.restore()

  // 2) Base: sin esto se vería la tela entre hilo e hilo y el bordado quedaría
  //    transparente. Va más oscura que el hilo para que las puntadas resalten.
  const capa = document.createElement('canvas')
  capa.width = out.width; capa.height = out.height
  const c = capa.getContext('2d')!
  c.drawImage(silueta, M, M)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = fondo
  c.fillRect(0, 0, capa.width, capa.height)
  c.globalCompositeOperation = 'source-over'

  // 3) Las puntadas. Se recorre la silueta en un sistema girado: `u` avanza a lo
  //    largo del hilo y `v` salta de una pasada a la siguiente.
  const th = anguloGrados * Math.PI / 180
  const cos = Math.cos(th), sin = Math.sin(th)
  const aXY = (u: number, v: number): [number, number] => [u * cos - v * sin, u * sin + v * cos]
  // Caja que cubre todo el dibujo ya girado.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (const [ex, ey] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const u =  ex * cos + ey * sin
    const v = -ex * sin + ey * cos
    if (u < uMin) uMin = u; if (u > uMax) uMax = u
    if (v < vMin) vMin = v; if (v > vMax) vMax = v
  }

  c.lineCap = 'butt'
  let fila = 0
  for (let v = vMin; v <= vMax; v += PASO, fila++) {
    // Las uniones se traban: media puntada de corrimiento en las filas impares.
    const salto = (fila % 2) * (LARGO / 2)
    let u = uMin
    while (u <= uMax) {
      // Buscar dónde empieza el hilo (primer píxel del dibujo).
      let [px, py] = aXY(u, v)
      if (!dentro(px, py)) { u += 1; continue }
      // Y hasta dónde llega, sin pasarse del largo máximo.
      const tope = u + LARGO - (u === uMin ? salto : 0)
      let fin = u
      while (fin + 1 <= uMax && fin + 1 <= tope) {
        const [qx, qy] = aXY(fin + 1, v)
        if (!dentro(qx, qy)) break
        fin += 1
      }
      if (fin - u < 1.5) { u = fin + 1; continue }

      const [x0, y0] = aXY(u, v)
      const [x1, y1] = aXY(fin, v)
      const n = rnd(fila * 131 + u)
      // Perpendicular al hilo: por ahí se corren el brillo y la sombra.
      const nx = -sin, ny = cos

      c.lineWidth = PASO * 0.92
      c.strokeStyle = hslToHex(hh, ss, clamp01(ll + (n - 0.5) * 0.07))
      c.beginPath(); c.moveTo(M + x0, M + y0); c.lineTo(M + x1, M + y1); c.stroke()

      // El hilo es redondo: brillo de un lado, sombra del otro.
      c.lineWidth = PASO * 0.30
      c.strokeStyle = claro
      c.globalAlpha = 0.55
      c.beginPath()
      c.moveTo(M + x0 - nx * PASO * 0.26, M + y0 - ny * PASO * 0.26)
      c.lineTo(M + x1 - nx * PASO * 0.26, M + y1 - ny * PASO * 0.26)
      c.stroke()
      c.strokeStyle = oscuro
      c.globalAlpha = 0.5
      c.beginPath()
      c.moveTo(M + x0 + nx * PASO * 0.34, M + y0 + ny * PASO * 0.34)
      c.lineTo(M + x1 + nx * PASO * 0.34, M + y1 + ny * PASO * 0.34)
      c.stroke()
      c.globalAlpha = 1

      u = fin + 1
    }
  }

  // 4) Recortar a la silueta: las puntadas se pasaron del borde a propósito,
  //    porque un hilo cortado al ras da el canto parejo del bordado real.
  c.globalCompositeOperation = 'destination-in'
  c.drawImage(silueta, M, M)
  c.globalCompositeOperation = 'source-over'

  // 5) Canto: un borde apenas más oscuro, para que el bordado tenga filo propio
  //    y no parezca recortado con tijera. Es la silueta MENOS la misma silueta
  //    encogida un píxel, o sea el anillo del borde.
  const encogida = document.createElement('canvas')
  encogida.width = out.width; encogida.height = out.height
  const e = encogida.getContext('2d')!
  e.drawImage(silueta, M, M)
  e.globalCompositeOperation = 'destination-in'
  for (const [dx, dy] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) e.drawImage(silueta, M + dx, M + dy)

  const canto = document.createElement('canvas')
  canto.width = out.width; canto.height = out.height
  const k = canto.getContext('2d')!
  k.drawImage(silueta, M, M)
  k.globalCompositeOperation = 'destination-out'
  k.drawImage(encogida, 0, 0)          // silueta − encogida = anillo del borde
  k.globalCompositeOperation = 'source-in'
  k.fillStyle = oscuro
  k.fillRect(0, 0, canto.width, canto.height)

  c.save()
  c.globalAlpha = 0.55
  c.drawImage(canto, 0, 0)
  c.restore()

  o.drawImage(capa, 0, 0)
  return out
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
const TEX_PRIMARY: Record<TextureKind, number> = { rayas: 1, denim: 0 }
// Dada la elección de color principal, deriva toda la paleta de la textura
function deriveTexPalette(kind: TextureKind, p: string): string[] {
  switch (kind) {
    case 'rayas': return [withL(p, 0.92, 0.5), p]
    case 'denim': return [p]
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
  } else {   // denim
    x.fillStyle = col[0]; x.fillRect(0, 0, s, s)
    for (let i = 0; i < 1400; i++) {
      const px = rnd(i) * s, py = rnd(i + 7) * s, b = rnd(i + 3)
      x.fillStyle = b > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,60,0.18)'
      x.fillRect(px, py, 1, 1)
    }
    x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1
    for (let i = -s; i < s; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s, s); x.stroke() }
  }
  return c
}

// ── Remera paramétrica: deforma el SVG REAL del usuario moviendo sus puntos ───
type Measures = {
  largoTotal: number; anchoPecho: number; anchoCintura: number
  anchoCuello: number; profundidadCuello: number; largoManga: number; anchoManga: number
}
// Unidades del path por centimetro real. El dibujo base esta calibrado a esta
// escala, asi que px_en_pantalla_por_cm = TEE_UNITS_PER_CM * (escala de encuadre).
export const TEE_UNITS_PER_CM = 5.086
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
// La silueta entera, de una sola pieza. Ya no se dibuja: quedan las tres de
// abajo, que juntas dan exactamente esto. Se conserva como referencia.
// @ts-expect-error se deja a proposito aunque no se use
const _TEE_SILUETA_ORIGINAL = "M292.24,4.64l201.19,54.3-23.15,119.05-69.33-4.77,8.03,184.05-328.13-1.07,11.64-183.05-69.91,4.91L1.14,50.05,205.89,1.08s22.26,16.91,86.35,3.56Z"

// El hueco del cuello: lo que se ve del OTRO lado de la remera al mirarla de frente.
// No es una pieza más, es un agujero, y por eso nunca lleva el estampado: la tela
// se ve por el revés. Sin esto el leopardo seguía de largo por el cuello y la
// prenda dejaba de leerse como una prenda.
//
// Se arma con geometría que ya existe, así encaja sin costuras aunque cambien las
// medidas: la curva del escote (TEE_DETAILS[6], que empieza y termina justo en los
// extremos del hombro) y la vuelta por el canto de arriba del cuerpo, que es la
// misma curva de TEE_BODY escrita al revés.
const TEE_INNER = "M205.89,1.08s7.91,55.81,41.09,55.81,42.6-42.75,45.26-52.25C228.15,17.99,205.89,1.08,205.89,1.08Z"

// Color del interior cuando el cuerpo tiene estampado (ahí no hay color liso del
// que derivarlo). Gris apagado: tiene que leerse como sombra, no como una pieza.
const TEE_INNER_FALLBACK = '#8f8f8f'
// La remera partida en CUERPO y dos MANGAS, para poder pintar cada parte por
// separado con el balde y darle su propia tela.
//
// El corte va por la costura de la sisa, que NO es una linea recta inventada:
// son las mismas curvas que ya se dibujaban como detalle (las dos que estaban
// en TEE_DETAILS y ahora se sacaron de ahi). Asi la costura de la pieza cae
// exactamente sobre la que el dibujo ya tenia.
//
// Los vertices compartidos entre piezas no abren hueco al cambiar las medidas
// porque la deformacion depende solo de la posicion del punto: un mismo punto
// se mueve igual, sea de la manga o del cuerpo.
const TEE_CUERPO =
  "M292.24,4.64 L392.43,31.46 " +
  "C392.43,31.46 367.17,77.13 400.96,173.24 " +      // sisa derecha, bajando
  "L408.98,357.27 L80.85,356.20 L92.49,173.16 " +
  "C126.28,77.06 101.36,26.21 101.36,26.21 " +       // sisa izquierda, subiendo
  "L205.89,1.08 s22.26,16.91 86.35,3.56 Z"

const TEE_MANGA_DER =
  "M392.43,31.46 L493.43,58.94 L470.28,177.99 L400.96,173.24 " +
  "C367.17,77.13 392.43,31.46 392.43,31.46 Z"

const TEE_MANGA_IZQ =
  "M101.36,26.21 L1.14,50.05 L22.58,178.06 L92.49,173.16 " +
  "C126.28,77.06 101.36,26.21 101.36,26.21 Z"

const TEE_DETAILS = [
  "M208.82,15.39s38.5,12.6,80.07,2.15",
  "M194.91,3.44s8.06,61.75,52.53,61.75,49.54-52.07,52.99-58.06",
  "M462.27,174.84L485.7,56.86",
  "M207.82,10.09s39.45,12.6,82.06,2.15",
  "M205.89,1.08s7.91,55.81,41.09,55.81,42.6-42.75,45.26-52.25",
  "M30.48,176.77L8.82,49.98",
  "M86.04,343.69L407.63,343.69",
]

// Transforma un path SVG aplicando W a cada coordenada (convierte todo a absoluto).
// W: mueve cada punto del SVG según las medidas (con medidas por defecto = identidad).
function teeWarp(m: Measures): (x: number, y: number) => [number, number] {
  const cx = 247.3, armY = 173, hemY = 357, URx = 400.95, ULx = 92.49
  // fLen modela el LARGO TOTAL real (HPS al ruedo): 33.8cm fijos del torso superior + la parte
  // inferior (36.2cm por defecto) que es la que se estira. fLen = 1 con largoTotal = 70.
  const fLen = (m.largoTotal - 33.8) / 36.2, fP = m.anchoPecho / 60, fC = m.anchoCintura / 63, fN = m.anchoCuello / 18
  const fML = m.largoManga / 18, fMA = m.anchoManga / 25, dProf = (m.profundidadCuello - 8) * 5.0
  return (x, y) => {
    const rSlv = x > 395 && y < 200, lSlv = x < 100 && y < 200
    // ── Manga ────────────────────────────────────────────────────────────────
    //
    // Cada punto se ubica por `t`: 0 = pegado al cuerpo (en la sisa), 1 = en la
    // boca de la manga. Todo lo que hace la manga —estirarse, ensancharse,
    // caer— se multiplica por `t`, así que EN LA SISA NO PASA NADA y el borde
    // va exactamente a donde fue a parar el cuerpo.
    //
    // Sin eso, agrandar mucho la manga arrastraba también la curva de la sisa
    // (la clasificación es por posición, y la sisa del CUERPO cae adentro de
    // esta rama): se estiraba, rotaba, y terminaba metida para adentro de la
    // remera.
    //
    // El ancho crece hacia ABAJO dejando quieto el borde de arriba, y cuanto
    // más larga es la manga más apunta para abajo (rota alrededor de la punta
    // del hombro, con tope para que no se pliegue sobre sí misma).
    if (rSlv || lSlv) {
      const sign = rSlv ? 1 : -1
      const hx  = rSlv ? 392.43 : 101.36, hy  = rSlv ? 31.46  : 26.21   // punta del hombro
      const ax  = rSlv ? URx    : ULx,    ay   = rSlv ? 173.24 : 173.16 // axila
      const bx1 = rSlv ? 493.43 : 1.14,   by1  = rSlv ? 58.94  : 50.05  // boca, arriba
      const bx2 = rSlv ? 470.28 : 22.58,  by2  = rSlv ? 177.99 : 178.06 // boca, abajo
      const cl = (v: number) => Math.max(0, Math.min(1, v))
      const xSisa = hx  + (ax  - hx)  * cl((y - hy)  / (ay  - hy))
      const xBoca = bx1 + (bx2 - bx1) * cl((y - by1) / (by2 - by1))
      const t = (x - xSisa) / (xBoca - xSisa)
      // t <= 0 es la sisa, o algo de adentro del cuerpo: cae en la regla del
      // cuerpo, que es la de más abajo.
      if (t > 0) {
        const pX = cx + (hx - cx) * fP, pY = hy
        // El borde de ARRIBA de la manga a esa distancia. El ancho crece desde
        // ahí hacia abajo, así que ese borde no se mueve nunca.
        const yArriba = hy + t * (by1 - hy)
        let ox = cx + (xSisa - cx) * fP + t * (xBoca - xSisa) * fML
        let oy = y + t * (fMA - 1) * (y - yArriba)
        const th = Math.min(0.46, Math.max(0, fML - 1) * 0.22) * sign * Math.min(1, t)
        const dx = ox - pX, dy = oy - pY
        ox = pX + dx * Math.cos(th) - dy * Math.sin(th)
        oy = pY + dx * Math.sin(th) + dy * Math.cos(th)
        return [ox, oy]
      }
    }
    if (y < 70 && Math.abs(x - cx) < 70) { const w = Math.max(0, Math.min(1, (y - 1) / 64)); return [cx + (x - cx) * fN, y + dProf * w] }
    const wf = y <= armY ? fP : y >= hemY ? fC : fP + (fC - fP) * ((y - armY) / (hemY - armY))
    return [cx + (x - cx) * wf, y <= armY ? y : armY + (y - armY) * fLen]
  }
}

// Devuelve las figuras de la remera en coordenadas cm (origen x=0 en el centro).
// La manga se ancla al hombro y a la axila: así el ancho de pecho mueve el costado
// y empuja la manga hacia afuera, como una remera real.
// ── Qué se guarda de un diseño ───────────────────────────────────────────────
//
// La prenda NO se guardaba: canvasJson era un array pelado con lo que el
// diseñador había puesto ENCIMA (dibujos, textos, imágenes), y la remera se
// reconstruía gris y con el talle por defecto cada vez que se abría el
// proyecto. Es decir: pintabas, guardabas, y al volver no había nada.
//
// Ahora canvasJson es un objeto que además guarda la prenda: sus medidas y la
// tela/color de cada pieza. Se sigue leyendo el formato viejo (un array) para
// no romper los proyectos que ya existen.
interface SavedPiece {
  /** Nombre estable de la pieza. Los proyectos viejos no lo tienen. */
  key?: string
  fill?: string
  tex?:  { kind: TextureKind; colors: string[] }
  eff?:  { kind: EffectKind; intensity: number }
  base?: string
  uTex?: { id: string; widthCm: number }
}
// `measures` son las de la remera y `medidas` las del pantalón o la chomba.
// Van en campos distintos a propósito: cada prenda tiene medidas propias y
// mezclarlas haría que abrir un pantalón le pisara el talle a la remera.
// `cortes` acepta el formato viejo (solo los puntos) y el nuevo, que ademas
// guarda a que pieza se le aplico el corte.
type SavedCorte = number[][] | { pts: number[][]; piezas?: string[] }
interface SavedGarment {
  measures?: Measures; medidas?: Medidas; pieces?: SavedPiece[]; cortes?: SavedCorte[]
  /** 2 = las medidas ya estan en la escala real del dibujo. Sin esto, son viejas. */
  medidasV?: number
}

/**
 * Pasa las medidas guardadas a la escala nueva.
 *
 * Los centimetros por defecto de la chomba y el pantalon no coincidian con lo
 * que el dibujo media de verdad (decia 56 de pecho donde habia 50,4). Al
 * corregirlos, un proyecto guardado con los viejos se veria distinto de como
 * quedo: se convierte proporcionalmente para que la prenda salga IGUAL, solo
 * que ahora el numero dice la verdad.
 */
function convertirMedidas(g: SavedGarment | null | undefined, prenda: PrendaParam): Medidas {
  const guardadas = g?.medidas
  if (!guardadas) return {}
  if ((g?.medidasV ?? 1) >= 2 || !prenda.defaultsV1) return guardadas
  const viejos = prenda.defaultsV1
  const out: Medidas = {}
  for (const [k, v] of Object.entries(guardadas)) {
    const antes = viejos[k], ahora = prenda.defaults[k]
    out[k] = (antes && ahora) ? v * (ahora / antes) : v
  }
  return out
}
interface SavedDesign  { objects: object[]; garment: SavedGarment | null }

function parseDesign(json: string): SavedDesign {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return { objects: parsed, garment: null }      // formato viejo
    return { objects: parsed?.objects ?? [], garment: parsed?.garment ?? null }
  } catch {
    return { objects: [], garment: null }
  }
}

interface FormaPrenda {
  d: string
  role: 'piece' | 'inner' | 'detail'
  /** Nombre estable de la pieza: con esto se restaura la pintura al reabrir. */
  key: string
  nombre?: string
  fill: string | null
  stroke: string
  strokeWidth: number
}

/**
 * Aplica los cortes guardados a las piezas de una prenda.
 *
 * Cada corte parte en dos toda pieza que cruce de lado a lado. Las que no cruza
 * quedan enteras. Se hace acá, al construir, para que sobreviva a cambiar las
 * medidas: el corte es parte de la RECETA de la prenda, no un objeto suelto.
 */
/**
 * Aplana un trazado a puntos, pase lo que pase por dentro.
 *
 * Los moldes de la chomba y el pantalon salen de un SVG y traen comandos que el
 * aplanador no entiende (arcos, atajos, relativos). Fabric los normaliza a
 * M/L/C/Q/Z al construir el trazado, asi que se le pasa por ahi primero: sin
 * esto el corte funcionaba en la remera y no hacia nada en las otras prendas.
 */
function aplanarTrazado(d: string): Punto[] {
  if (!d) return []
  const cmds = (new fabric.Path(d) as any).path as any[] | undefined
  if (!cmds?.length) return aplanarPath(d)
  let simple = ''
  for (const c of cmds) simple += c[0] + ' ' + c.slice(1).join(' ') + ' '
  return aplanarPath(simple)
}

/**
 * Si un corte le toca a esa pieza.
 *
 * Un corte con alcance apunta a la pieza tal como se llamaba cuando se hizo;
 * los pedazos que salgan de ella heredan el nombre con `#1`, `#2`, asi que un
 * corte posterior sobre uno de esos pedazos lo sigue encontrando.
 */
function alcanzaA(corte: { piezas?: string[] }, key: string): boolean {
  if (!corte.piezas?.length) return true          // proyectos viejos: toda la prenda
  return corte.piezas.some(p => key === p || key.startsWith(p + '#'))
}

function aplicarCortes(formas: FormaPrenda[], cortes: { pts: Punto[]; piezas?: string[] }[]): FormaPrenda[] {
  if (!cortes.length) return formas
  let actuales = formas
  for (const corte of cortes) {
    const siguientes: FormaPrenda[] = []
    for (const f of actuales) {
      if (f.role !== 'piece' || !alcanzaA(corte, f.key)) { siguientes.push(f); continue }
      const partes = partirPoligono(aplanarTrazado(f.d), corte.pts)
      if (!partes) { siguientes.push(f); continue }
      // El que tiene el centro más arriba es el de arriba. Nombrarlas así hace
      // que la lista de capas se entienda sin tener que clickear cada una.
      const centro = (q: Punto[]) => q.reduce((a, b) => a + b[1], 0) / q.length
      const ordenadas = partes[0] && centro(partes[0]) <= centro(partes[1]) ? partes : [partes[1], partes[0]]
      ordenadas.forEach((q, i) => siguientes.push({
        ...f,
        d: poligonoAPath(q),
        key: `${f.key}#${i + 1}`,
        nombre: `${f.nombre ?? f.key} · ${i === 0 ? 'arriba' : 'abajo'}`,
      }))
    }
    actuales = siguientes
  }
  return actuales
}

function buildTeeShapes(m: Measures): FormaPrenda[] {
  const W = teeWarp(m)
  const shapes: FormaPrenda[] = [
    { d: transformPath(TEE_CUERPO, W), role: 'piece', key: 'cuerpo', nombre: 'Cuerpo',
      fill: '#b2b2b2', stroke: '#010101', strokeWidth: 2 },
    { d: transformPath(TEE_MANGA_IZQ, W), role: 'piece', key: 'manga-izq', nombre: 'Manga izquierda',
      fill: '#b2b2b2', stroke: '#010101', strokeWidth: 2 },
    { d: transformPath(TEE_MANGA_DER, W), role: 'piece', key: 'manga-der', nombre: 'Manga derecha',
      fill: '#b2b2b2', stroke: '#010101', strokeWidth: 2 },
    // Va después del cuerpo y antes de los detalles: tapa el estampado y las
    // líneas del escote le quedan dibujadas encima.
    { d: transformPath(TEE_INNER, W), role: 'inner', key: 'escote', nombre: 'Interior del cuello',
      fill: TEE_INNER_FALLBACK, stroke: 'transparent', strokeWidth: 0 },
  ]
  TEE_DETAILS.forEach((d, i) => shapes.push({
    d: transformPath(d, W), role: 'detail', key: 'detalle-' + i,
    fill: null, stroke: '#1d1d1b', strokeWidth: 2,
  }))
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

// Botón agrupado "Figuras": un solo botón que despliega todas las formas
// (rectángulo, elipse, polígono, estrella, línea, símbolo…) en un flyout.
function ShapeToolGroup({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const shapes: { k: Tool; label: string; icon: React.ReactNode }[] = [
    { k: 'rect',    label: 'Rectángulo (M)',   icon: <IconRect /> },
    { k: 'rrect',   label: 'Rect. redondeado', icon: <IconRRect /> },
    { k: 'ellipse', label: 'Elipse (L)',       icon: <IconEllipse /> },
    { k: 'polygon', label: 'Polígono',         icon: <IconPolygon /> },
    { k: 'star',    label: 'Estrella',         icon: <IconStar /> },
    { k: 'line',    label: 'Línea (\\)',        icon: <IconLine /> },
    { k: 'symbol',  label: 'Símbolo · sello',  icon: <IconSymbol /> },
  ]
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<Tool>('rect')
  const isShape = shapes.some(s => s.k === tool)
  useEffect(() => { if (isShape) setLast(tool) }, [tool, isShape])
  const shown = shapes.find(s => s.k === (isShape ? tool : last)) ?? shapes[0]

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Figuras" style={{
        width: 36, height: 36, borderRadius: 8, flexShrink: 0, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: (isShape || open) ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
        border: '1.5px solid ' + ((isShape || open) ? 'var(--accent)' : 'transparent'),
        color: (isShape || open) ? 'var(--accent)' : 'var(--fg-2)',
        cursor: 'pointer', fontSize: 16, transition: 'all 0.15s var(--ease)',
      }}>
        {shown.icon}
        {/* triángulo indicador de submenú */}
        <span style={{
          position: 'absolute', right: 3, bottom: 3, width: 0, height: 0,
          borderLeft: '4px solid transparent', borderBottom: '4px solid currentColor', opacity: 0.7,
        }} />
      </button>
      {open && (
        <>
          {/* backdrop: cierra el flyout al clickear afuera */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{
            position: 'absolute', left: 'calc(100% + 8px)', top: 0, zIndex: 70,
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
            boxShadow: '0 10px 30px rgb(0 0 0 / 0.28)', minWidth: 184,
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 8px 6px', letterSpacing: '0.06em' }}>FIGURAS</div>
            {shapes.map(s => {
              const active = tool === s.k
              return (
                <button key={s.k} title={s.label}
                  onClick={() => { setTool(s.k); setLast(s.k); setOpen(false) }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '7px 10px', borderRadius: 7, fontSize: 13, textAlign: 'left',
                    background: active ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'transparent',
                    border: '1px solid ' + (active ? 'var(--accent)' : 'transparent'),
                    color: active ? 'var(--accent)' : 'var(--fg)',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.12s var(--ease)',
                  }}>
                  <span style={{ width: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: active ? 'var(--accent)' : 'var(--fg-2)' }}>{s.icon}</span>
                  {s.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
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

const IconRRect = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2.5" y="3.5" width="11" height="9" rx="3" />
  </svg>
)

const IconPolygon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <path d="M8 2 L14 6 L11.5 13 L4.5 13 L2 6 Z" />
  </svg>
)

const IconStar = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="M8 1.5 L9.8 6 L14.5 6.2 L10.8 9.1 L12.1 13.7 L8 11 L3.9 13.7 L5.2 9.1 L1.5 6.2 L6.2 6 Z" />
  </svg>
)

const IconSymbol = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="2" y="2" width="8" height="8" rx="1.5" />
    <rect x="6" y="6" width="8" height="8" rx="1.5" opacity="0.55" />
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
  if (kind === 'costura') return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="2" y1="7" x2="5" y2="7" /><line x1="7.5" y1="7" x2="10.5" y2="7" />
      <line x1="13" y1="7" x2="16" y2="7" /><line x1="18" y1="7" x2="18.5" y2="7" />
    </svg>
  )
  // cierre: dos cintas y la cadena de dientes en el medio
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <line x1="6.5" y1="1.5" x2="6.5" y2="12.5" /><line x1="13.5" y1="1.5" x2="13.5" y2="12.5" />
      <g stroke="currentColor" strokeWidth="2.1">
        <line x1="8" y1="3" x2="12" y2="3" /><line x1="8" y1="5.4" x2="12" y2="5.4" />
        <line x1="8" y1="7.8" x2="12" y2="7.8" /><line x1="8" y1="10.2" x2="12" y2="10.2" />
      </g>
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
