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
  /**
   * Los valores por defecto ANTERIORES a medir el dibujo.
   *
   * Los primeros numeros eran de catalogo y no coincidian con la prenda
   * dibujada. Al corregirlos, un proyecto ya guardado cambiaria de forma solo;
   * con esto se convierten al abrirlo y la prenda se ve igual que cuando se
   * guardo, pero con los cm ya arreglados.
   */
  defaultsV1?: Medidas
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
//   y=13.5 → 93.1    y=95 → 120.4    y=190 → 140.8    y=282 → 152.1
// El largo da 100 cm justos a 2.94 unidades por cm, y esa misma escala se usa
// para los anchos: antes los anchos salian de una escala distinta (2.3) y por
// eso decian 40 de cintura donde el dibujo tenia 31,5.
const PANT_CX    = 77.5     // centro entre las dos piernas
const PANT_Y_TOP = 1.1

const PANT_UPC = 2.94
/**
 * Lo que mide el dibujo, en cm. Cintura y cadera van de lado a lado de la
 * prenda, como se mide un pantalon apoyado en la mesa; rodilla y ruedo son de
 * UNA pierna.
 */
const PANT_CM = { largoTotal: 100, cintura: 31.5, cadera: 41, rodilla: 22, ruedo: 22.5 }

const pantalon: PrendaParam = {
  svg: '/mockups/pants.svg',
  unidadesPorCm: PANT_UPC,
  defaults: { ...PANT_CM },
  defaultsV1: { largoTotal: 100, cintura: 40, cadera: 52, rodilla: 61, ruedo: 63 },
  campos: [
    { key: 'largoTotal', label: 'Largo total',    min: 70, max: 130 },
    { key: 'cintura',    label: 'Cintura',        min: 22, max: 50 },
    { key: 'cadera',     label: 'Cadera',         min: 30, max: 62 },
    { key: 'rodilla',    label: 'Rodilla',        min: 12, max: 42 },
    { key: 'ruedo',      label: 'Ruedo',          min: 10, max: 45 },
  ],
  grupos: [
    { id: 'largo',  label: 'Largo',            keys: ['largoTotal'] },
    { id: 'arriba', label: 'Cintura y cadera', keys: ['cintura', 'cadera'] },
    { id: 'pierna', label: 'Pierna',           keys: ['rodilla', 'ruedo'] },
  ],
  warp: (m) => {
    const fLargo = m.largoTotal / PANT_CM.largoTotal
    const ctrl: [number, number][] = [
      [13.5, m.cintura / PANT_CM.cintura],
      [95,   m.cadera  / PANT_CM.cadera],
      [190,  m.rodilla / PANT_CM.rodilla],
      [282,  m.ruedo   / PANT_CM.ruedo],
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
//
// TODO lo de acá abajo está MEDIDO del archivo (`public/mockups/chomba.svg`),
// que es un dibujo de líneas rectas: se leyeron sus vértices y se calcularon
// los anchos reales a cada altura. Los centímetros por defecto son los que el
// dibujo mide de verdad, no valores de catálogo: antes decían 56 de pecho
// cuando el dibujo tenía 50,4, y por eso cualquier cambio salía desproporcionado
// (pedir 26 de cuello daba 36 reales).
//
// El archivo trae FRENTE y ESPALDA una al lado de la otra. Cada mitad se deforma
// alrededor de SU propio centro; si se usara uno solo, tocar el ancho de pecho
// separaría las dos mitades en vez de ensanchar la prenda.
const CHOMBA_UPC = 3.065          // unidades del dibujo por cm
const CHOMBA_CX_FRENTE  = 129.58
const CHOMBA_CX_ESPALDA = 399.15
const CHOMBA_Y_CUELLO = 14.83     // punto alto del hombro: de acá arranca el escote
const CHOMBA_Y_MANGA  = 28.90     // costura del hombro (arriba de la manga)
const CHOMBA_Y_SISA   = 104.96    // axila: abajo de la sisa
const CHOMBA_Y_RUEDO  = 227.95
const CHOMBA_Y_ABAJO  = 235.49    // abajo de la tira del ruedo
// El escote: ningún punto suyo pasa de |dx|=39 ni de y=61, y la punta del hombro
// está en |dx|=74. Con estos límites se separan sin tocarse.
const CHOMBA_ESCOTE_X = 45
const CHOMBA_ESCOTE_Y = 61
// El hombro acompaña al pecho A LA MITAD. Ensanchar 10 cm el pecho no ensancha
// 10 cm los hombros; sin esto, subir un talle los mandaba para el costado.
const CHOMBA_HOMBRO_PROP = 0.5
// El borde de la manga pegado al cuerpo (la sisa) y el de la boca, por altura.
// Están tomados de la manga IZQUIERDA del frente: las otras tres son su espejo
// o van corridas.
const CHOMBA_SISA_X: [number, number][] = [
  [28.90, 54.95], [47.40, 57.36], [71.54, 57.36], [95.17, 54.87], [104.36, 51.53],
]
const CHOMBA_BOCA_X: [number, number][] = [[47.68, 6.63], [104.36, 18.91]]
// El borde de ARRIBA de la manga: arranca en la costura del hombro y termina
// arriba de la boca. El ancho crece desde ese borde hacia ABAJO, así que el
// borde no se mueve nunca.
const CHOMBA_MANGA_ARRIBA = 47.68
// Cuanto más larga la manga, más apunta para abajo. Con tope, para que no se
// pliegue sobre sí misma.
const CHOMBA_CAIDA_MAX = 0.40

/** Lo que mide el dibujo, en cm. Con estos valores la prenda sale sin tocar. */
const CHOMBA_CM = {
  largoTotal: 72, anchoPecho: 50.5, anchoCintura: 51.5,
  anchoCuello: 23.5, profundidadCuello: 15, largoManga: 17, anchoManga: 18,
}

const chomba: PrendaParam = {
  svg: '/mockups/chomba.svg',
  unidadesPorCm: CHOMBA_UPC,
  defaults: { ...CHOMBA_CM },
  // Lo que decían los valores por defecto antes de medir el dibujo. Sirve para
  // convertir los proyectos ya guardados y que no cambien de forma.
  defaultsV1: {
    largoTotal: 72, anchoPecho: 56, anchoCintura: 60,
    anchoCuello: 17, profundidadCuello: 15, largoManga: 21, anchoManga: 21,
  },
  campos: [
    { key: 'largoTotal',   label: 'Largo total',      min: 55, max: 95 },
    { key: 'anchoPecho',   label: 'Ancho de pecho',   min: 38, max: 75 },
    { key: 'anchoCintura', label: 'Ancho de cintura', min: 38, max: 78 },
    { key: 'anchoCuello',  label: 'Ancho de cuello',  min: 16, max: 34 },
    { key: 'profundidadCuello', label: 'Profundidad de cuello', min: 6, max: 30 },
    { key: 'largoManga',   label: 'Largo de manga',   min: 8,  max: 40 },
    { key: 'anchoManga',   label: 'Ancho de manga',   min: 12, max: 32 },
  ],
  grupos: [
    { id: 'largo',  label: 'Largo',                 keys: ['largoTotal'] },
    { id: 'ancho',  label: 'Ancho (pecho/cintura)', keys: ['anchoPecho', 'anchoCintura'] },
    { id: 'cuello', label: 'Cuello',                keys: ['anchoCuello', 'profundidadCuello'] },
    { id: 'manga',  label: 'Manga',                 keys: ['largoManga', 'anchoManga'] },
  ],
  warp: (m, id) => {
    const fPecho   = m.anchoPecho   / CHOMBA_CM.anchoPecho
    const fCintura = m.anchoCintura / CHOMBA_CM.anchoCintura
    const fCuello  = m.anchoCuello  / CHOMBA_CM.anchoCuello
    const fProf    = m.profundidadCuello / CHOMBA_CM.profundidadCuello
    const fMangaL  = m.largoManga   / CHOMBA_CM.largoManga
    const fMangaA  = m.anchoManga   / CHOMBA_CM.anchoManga

    // El largo estira SOLO de la axila para abajo. Arriba están la sisa, el
    // hombro y el cuello, que no cambian porque la prenda sea más larga: antes
    // se estiraba desde el hombro, la sisa se iba para abajo sola y la manga
    // quedaba colgando en el aire.
    const altoFijo = CHOMBA_Y_SISA - CHOMBA_Y_CUELLO
    const fLargo = Math.max(0.15,
      (m.largoTotal * CHOMBA_UPC - altoFijo) / (CHOMBA_Y_ABAJO - CHOMBA_Y_SISA))

    const off = id.endsWith('-back') ? CHOMBA_CX_ESPALDA - CHOMBA_CX_FRENTE : 0
    const cx  = CHOMBA_CX_FRENTE + off

    const alto = (y: number) =>
      y <= CHOMBA_Y_SISA ? y : CHOMBA_Y_SISA + (y - CHOMBA_Y_SISA) * fLargo

    // Cuánto se abre la prenda a cada altura. Una sola función para todo: la
    // usa el cuerpo Y la usa la manga para saber dónde quedó la sisa, así las
    // dos se mueven juntas y la manga no se despega nunca.
    const fHombro = 1 + (fPecho - 1) * CHOMBA_HOMBRO_PROP
    const ancho = (y: number) =>
      y <= CHOMBA_Y_MANGA ? fHombro :
      y <= CHOMBA_Y_SISA  ? fHombro + (fPecho - fHombro) * ((y - CHOMBA_Y_MANGA) / (CHOMBA_Y_SISA - CHOMBA_Y_MANGA)) :
      y >= CHOMBA_Y_RUEDO ? fCintura :
      fPecho + (fCintura - fPecho) * ((y - CHOMBA_Y_SISA) / (CHOMBA_Y_RUEDO - CHOMBA_Y_SISA))

    // Qué tan hondo baja el escote. Se mide desde la costura del hombro: lo que
    // está por encima (la tira del cuello) no se mueve, y lo que baja del
    // escote se alarga o se acorta.
    const hondo = (y: number) =>
      y <= CHOMBA_Y_CUELLO ? y : CHOMBA_Y_CUELLO + (y - CHOMBA_Y_CUELLO) * fProf

    // El cuello cosido y la vista: se abren de ancho y bajan de profundidad.
    if (id.includes('collar') || id.includes('escote')) {
      return (x, y) => [cx + (x - cx) * fCuello, hondo(y)]
    }

    // Manga y puño. La cuenta se hace SIEMPRE como si fuera la manga izquierda
    // del frente; la derecha es su espejo y la espalda va corrida.
    if (id.includes('sleeve') || id.includes('cuff')) {
      const der = id.includes('right')
      const aIzq   = (x: number) => der ? 2 * CHOMBA_CX_FRENTE - (x - off) : x - off
      const aFinal = (u: number) => (der ? 2 * CHOMBA_CX_FRENTE - u : u) + off
      // La punta del hombro, que es por donde cuelga la manga.
      const hombroU = CHOMBA_CX_FRENTE
        + (factorPorAltura(CHOMBA_Y_MANGA, CHOMBA_SISA_X) - CHOMBA_CX_FRENTE) * ancho(CHOMBA_Y_MANGA)
      // Hacia la izquierda, caer es girar al revés.
      const th = -Math.min(CHOMBA_CAIDA_MAX, Math.max(0, fMangaL - 1) * 0.22)
      return (x, y) => {
        const u = aIzq(x)
        const sisa = factorPorAltura(y, CHOMBA_SISA_X)
        const boca = factorPorAltura(y, CHOMBA_BOCA_X)
        // 0 = pegado al cuerpo, 1 = en la boca de la manga. Todo lo que hace la
        // manga se multiplica por esto, así que EN LA SISA NO PASA NADA: el
        // borde va exactamente a donde fue a parar el cuerpo.
        const t = (sisa - u) / (sisa - boca)
        const sisaNueva = CHOMBA_CX_FRENTE + (sisa - CHOMBA_CX_FRENTE) * ancho(y)
        // El borde de arriba de la manga a esa distancia: el ancho crece de ahí
        // hacia ABAJO y ese borde no se mueve, igual que en la remera.
        const yArriba = CHOMBA_Y_MANGA + t * (CHOMBA_MANGA_ARRIBA - CHOMBA_Y_MANGA)
        const uu = sisaNueva - t * (sisa - boca) * fMangaL
        const vv = y + t * (fMangaA - 1) * (y - yArriba)
        // Y cuanto más larga, más apunta para abajo: gira alrededor de la punta
        // del hombro, pero de a poco, así la sisa se queda donde está.
        const a = th * Math.min(1, Math.max(0, t))
        const du = uu - hombroU, dv = vv - CHOMBA_Y_MANGA
        return [
          aFinal(hombroU + du * Math.cos(a) - dv * Math.sin(a)),
          CHOMBA_Y_MANGA + du * Math.sin(a) + dv * Math.cos(a),
        ]
      }
    }

    // Cuerpo y ruedo.
    return (x, y) => {
      const dx = x - cx
      // El escote está dibujado dentro del cuerpo. Si se ensanchara con el
      // pecho, subir un talle agrandaría el cuello y el cuello cosido —que sigue
      // a SU medida— se despegaría del cuerpo.
      const enEscote = y <= CHOMBA_ESCOTE_Y && Math.abs(dx) <= CHOMBA_ESCOTE_X
      if (enEscote) return [cx + dx * fCuello, hondo(y)]
      return [cx + dx * ancho(y), alto(y)]
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
