// Pantalón y chomba por medidas.
//
// La remera ya era paramétrica: se le cambia una medida y la prenda se REHACE,
// no se estira. Estas dos hacían lo otro —escalar el dibujo entero— así que
// alargar el pantalón también lo ensanchaba. Acá está lo que faltaba para que
// funcionen igual que la remera.
//
// Cómo funciona: cada pieza del SVG pasa por una función que mueve sus puntos
// según las medidas. Cada pieza tiene su propia regla (una manga no se deforma
// como un cuerpo), y por eso se trabaja POR PIEZA y no por zonas del dibujo: el
// id que trae el archivo dice qué es cada cosa, sin tener que adivinarlo por
// dónde cae un punto.
//
// Los números de referencia salieron de MEDIR el dibujo (ancho real a cada
// altura), no a ojo. Con las medidas por defecto todos los factores dan 1, o
// sea que la prenda sale idéntica al archivo original.

import type { Warp } from './pathWarp'

export type Medidas = Record<string, number>

export interface CampoMedida { key: string; label: string; min: number; max: number }
export interface GrupoMedida { id: string; label: string; keys: string[] }

export interface PrendaParam {
  svg: string
  /** Unidades del dibujo por cm, para que el estampado salga a escala real. */
  unidadesPorCm: number
  defaults: Medidas
  campos: CampoMedida[]
  /** Agrupadas para el panel: plegado se edita el grupo, desplegado una por una. */
  grupos: GrupoMedida[]
  /** La regla de deformación de UNA pieza. */
  warp: (m: Medidas, piezaId: string) => Warp
  /**
   * Si el archivo trae la prenda dibujada DOS veces (frente y espalda, una al
   * lado de la otra), dice cuáles piezas son la segunda.
   *
   * Hace falta porque cada mitad se ensancha alrededor de su propio centro:
   * sin esto, al subir el ancho de pecho las dos mitades crecían una contra la
   * otra hasta encimarse. Con esto la separación entre ambas se mantiene.
   */
  segundaMitad?: (piezaId: string) => boolean
}

/** Interpola el factor de ancho entre puntos de control (altura → factor). */
function factorPorAltura(y: number, ctrl: [number, number][]): number {
  if (y <= ctrl[0][0]) return ctrl[0][1]
  const ult = ctrl[ctrl.length - 1]
  if (y >= ult[0]) return ult[1]
  for (let i = 1; i < ctrl.length; i++) {
    const [y0, f0] = ctrl[i - 1], [y1, f1] = ctrl[i]
    if (y <= y1) return f0 + (f1 - f0) * ((y - y0) / (y1 - y0))
  }
  return ult[1]
}

// ── Pantalón ─────────────────────────────────────────────────────────────────
// Medido del archivo: el dibujo va de y=1.1 (cintura) a y=295 (ruedo) y se
// ensancha hacia abajo (es de pierna ancha). Anchos reales del dibujo:
//   y=13.5 → 92    y=95 → 120    y=190 → 140    y=282 → 146
// A 2.3 unidades por cm dan 40, 52, 61 y 63 cm, que son los valores por defecto.
const PANT_CX    = 77.5     // centro entre las dos piernas
const PANT_Y_TOP = 1.1

const pantalon: PrendaParam = {
  svg: '/mockups/pants.svg',
  // A lo LARGO el dibujo tiene otra escala que a lo ancho (es un dibujo
  // estilizado, no un plano). Para el estampado manda la vertical.
  unidadesPorCm: 2.94,
  defaults: { largoTotal: 100, cintura: 40, cadera: 52, rodilla: 61, ruedo: 63 },
  campos: [
    { key: 'largoTotal', label: 'Largo total',    min: 70, max: 130 },
    { key: 'cintura',    label: 'Cintura',        min: 28, max: 60 },
    { key: 'cadera',     label: 'Cadera',         min: 38, max: 75 },
    { key: 'rodilla',    label: 'Rodilla',        min: 30, max: 85 },
    { key: 'ruedo',      label: 'Ruedo',          min: 24, max: 90 },
  ],
  grupos: [
    { id: 'largo',  label: 'Largo',            keys: ['largoTotal'] },
    { id: 'arriba', label: 'Cintura y cadera', keys: ['cintura', 'cadera'] },
    { id: 'pierna', label: 'Pierna',           keys: ['rodilla', 'ruedo'] },
  ],
  warp: (m) => {
    const fLargo = m.largoTotal / 100
    const ctrl: [number, number][] = [
      [13.5, m.cintura / 40],
      [95,   m.cadera  / 52],
      [190,  m.rodilla / 61],
      [282,  m.ruedo   / 63],
    ]
    return (x, y) => {
      const f = factorPorAltura(y, ctrl)
      return [
        PANT_CX + (x - PANT_CX) * f,
        // El largo se estira desde la cintura: la cintura se queda quieta y lo
        // que baja es el ruedo, como al alargar un pantalón de verdad.
        PANT_Y_TOP + (y - PANT_Y_TOP) * fLargo,
      ]
    }
  },
}

// ── Chomba ───────────────────────────────────────────────────────────────────
// El archivo trae FRENTE y ESPALDA una al lado de la otra. Cada mitad se deforma
// alrededor de SU propio centro; si se usara uno solo, tocar el ancho de pecho
// separaría las dos mitades en vez de ensanchar la prenda.
const CHOMBA_CX_FRENTE = 129.6
const CHOMBA_CX_ESPALDA = 399.15
const CHOMBA_Y_HOMBRO  = 14.8    // arriba del cuerpo; desde acá se mide el largo
const CHOMBA_Y_SISA    = 104     // abajo de la manga
const CHOMBA_Y_RUEDO   = 228
const CHOMBA_Y_MANGA   = 28.9    // arriba de la manga (la costura del hombro)
// Donde la manga se pega al cuerpo, en el FRENTE (la espalda va corrida).
const CHOMBA_X_SISA_IZQ = 57.4
const CHOMBA_X_SISA_DER = 201.8

const chomba: PrendaParam = {
  svg: '/mockups/chomba.svg',
  unidadesPorCm: 3.065,
  defaults: { largoTotal: 72, anchoPecho: 56, anchoCintura: 60, anchoCuello: 17, largoManga: 21, anchoManga: 21 },
  campos: [
    { key: 'largoTotal',   label: 'Largo total',      min: 58, max: 95 },
    { key: 'anchoPecho',   label: 'Ancho de pecho',   min: 42, max: 78 },
    { key: 'anchoCintura', label: 'Ancho de cintura', min: 44, max: 82 },
    { key: 'anchoCuello',  label: 'Ancho de cuello',  min: 12, max: 26 },
    { key: 'largoManga',   label: 'Largo de manga',   min: 12, max: 40 },
    { key: 'anchoManga',   label: 'Ancho de manga',   min: 14, max: 34 },
  ],
  grupos: [
    { id: 'largo',  label: 'Largo',                 keys: ['largoTotal'] },
    { id: 'ancho',  label: 'Ancho (pecho/cintura)', keys: ['anchoPecho', 'anchoCintura'] },
    { id: 'cuello', label: 'Cuello',                keys: ['anchoCuello'] },
    { id: 'manga',  label: 'Manga',                 keys: ['largoManga', 'anchoManga'] },
  ],
  warp: (m, id) => {
    const fPecho   = m.anchoPecho   / 56
    const fCintura = m.anchoCintura / 60
    const fCuello  = m.anchoCuello  / 17
    const fLargo   = m.largoTotal   / 72
    const fMangaL  = m.largoManga   / 21
    const fMangaA  = m.anchoManga   / 21

    const espalda = id.endsWith('-back')
    const cx  = espalda ? CHOMBA_CX_ESPALDA : CHOMBA_CX_FRENTE
    const off = espalda ? CHOMBA_CX_ESPALDA - CHOMBA_CX_FRENTE : 0

    // El cuello y su vista: solo se abren o se cierran, no siguen al largo.
    if (id.includes('collar') || id.includes('escote')) {
      return (x, y) => [cx + (x - cx) * fCuello, y]
    }

    // Manga y puño: se alargan hacia AFUERA desde la sisa y se ensanchan hacia
    // abajo, colgando del hombro. La sisa se mueve sola con el ancho de pecho,
    // así que la manga sigue al cuerpo en vez de despegarse de él.
    if (id.includes('sleeve') || id.includes('cuff')) {
      const izq = id.includes('left')
      const xSisa = (izq ? CHOMBA_X_SISA_IZQ : CHOMBA_X_SISA_DER) + off
      const xSisaNueva = cx + (xSisa - cx) * fPecho
      return (x, y) => [
        xSisaNueva + (x - xSisa) * fMangaL,
        CHOMBA_Y_MANGA + (y - CHOMBA_Y_MANGA) * fMangaA,
      ]
    }

    // Cuerpo y ruedo.
    return (x, y) => {
      const dx = x - cx
      // El escote está dibujado dentro del cuerpo: si se ensanchara con el
      // pecho, subir una talle agrandaría el cuello. Se lo trata aparte.
      if (y < 62 && Math.abs(dx) < 32) return [cx + dx * fCuello, y]
      const f = y <= CHOMBA_Y_SISA ? fPecho
              : y >= CHOMBA_Y_RUEDO ? fCintura
              : fPecho + (fCintura - fPecho) * ((y - CHOMBA_Y_SISA) / (CHOMBA_Y_RUEDO - CHOMBA_Y_SISA))
      return [
        cx + dx * f,
        // Arriba del hombro no hay nada que alargar; de la sisa para abajo sí.
        y <= CHOMBA_Y_HOMBRO ? y : CHOMBA_Y_HOMBRO + (y - CHOMBA_Y_HOMBRO) * fLargo,
      ]
    }
  },
}

chomba.segundaMitad = (id) => id.endsWith('-back')

/** Las prendas que se pueden editar por medidas, además de la remera. */
export const PRENDAS_PARAM: Record<string, PrendaParam> = { pants: pantalon, chomba }

/** Una pieza del dibujo, ya leída del archivo. */
export interface PiezaSvg {
  id: string
  d: string
  fill: string | null
  stroke: string
  strokeWidth: number
}

/**
 * Lee las piezas de un SVG.
 *
 * Se usa el parser del navegador y no una expresión regular: los atributos
 * pueden venir en cualquier orden y con comillas distintas, y una regex ahí
 * falla en silencio (deja la prenda sin una pieza y nadie se entera).
 */
export async function leerPiezasSvg(url: string): Promise<PiezaSvg[]> {
  const txt = await fetch(url).then(r => r.text())
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return []
  return [...doc.querySelectorAll('path')]
    .map(el => {
      const f = el.getAttribute('fill')
      const sw = el.getAttribute('stroke-width')
      return {
        id: el.getAttribute('id') ?? '',
        d:  el.getAttribute('d')  ?? '',
        fill: (!f || f === 'none') ? null : f,
        stroke: el.getAttribute('stroke') ?? 'transparent',
        strokeWidth: sw ? Number(sw) : 0,
      }
    })
    .filter(p => p.d)
}
