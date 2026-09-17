// Preparar una imagen ANTES de calcarla.
//
// Calcar el PNG tal cual es la razón por la que un logo simple —una silueta de
// un solo color— salía hecho un desastre. Tres motivos, y los tres se arreglan
// acá y no tocando los ajustes del calcador:
//
// 1. El borde suavizado. Un PNG no tiene bordes limpios: tiene una franja de
//    píxeles intermedios entre la figura y el fondo. El calcador los toma como
//    colores de verdad y saca capas de relleno fantasma, una adentro de otra.
//
// 2. La transparencia. En un logo recortado, los píxeles invisibles suelen
//    guardar negro con alfa 0. Al calcar, ese negro invisible se mezcla con el
//    negro del logo y la figura se come el fondo.
//
// 3. El tamaño. Un logo chico (200 px) tiene los detalles finos —una pata, un
//    palo— de dos o tres píxeles. Calcado a ese tamaño, el detalle desaparece o
//    sale con escalones.
//
// Lo que se hace: aplanar sobre el fondo, agrandar si es chico, y PEGAR cada
// píxel al color más cercano de la paleta real. Después el calcador recibe una
// imagen de colores planos y bordes limpios, que es lo que sabe calcar bien.

export interface ImagenParaCalco {
  data: ImageData
  /** Los colores de verdad de la imagen, el primero es el del fondo. */
  paleta: [number, number, number][]
  fondo: [number, number, number]
  /** true si el fondo era transparente (y por eso no hay que dibujarlo). */
  fondoTransparente: boolean
}

const dist2 = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/**
 * Colores que de verdad ocupan superficie.
 *
 * Se agrupan en cubos gruesos y se descartan los que casi no aparecen: esos no
 * son colores del dibujo, son la transición del borde suavizado. De cada grupo
 * que sobrevive se saca el color PROMEDIO, que es más fiel que el del cubo.
 */
function paletaReal(px: Uint8ClampedArray, total: number, maxColores: number): [number, number, number][] {
  const cubos = new Map<number, { n: number; r: number; g: number; b: number }>()
  const paso = Math.max(1, Math.floor(total / 60000))
  let visibles = 0
  for (let i = 0; i < total; i += paso) {
    const p = i * 4
    if (px[p + 3] < 128) continue
    visibles++
    const k = (px[p] >> 4 << 8) | (px[p + 1] >> 4 << 4) | (px[p + 2] >> 4)
    const c = cubos.get(k)
    if (c) { c.n++; c.r += px[p]; c.g += px[p + 1]; c.b += px[p + 2] }
    else cubos.set(k, { n: 1, r: px[p], g: px[p + 1], b: px[p + 2] })
  }
  if (!visibles) return [[255, 255, 255]]
  const minimo = Math.max(1, visibles * 0.005)
  const vivos = [...cubos.values()].filter(c => c.n >= minimo).sort((a, b) => b.n - a.n)
  const lista = (vivos.length ? vivos : [...cubos.values()].sort((a, b) => b.n - a.n).slice(0, 2))
    .slice(0, maxColores)
    .map(c => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)] as [number, number, number])

  // Dos grupos casi del mismo color son el mismo color partido en dos cubos.
  const juntos: [number, number, number][] = []
  for (const c of lista) if (!juntos.some(j => dist2(j, c) < 26 * 26)) juntos.push(c)
  return juntos.length ? juntos : [[0, 0, 0]]
}

/**
 * Deja la imagen lista para calcar.
 *
 * `maxColores` es el techo de la paleta: para un logo plano conviene poco (4-8);
 * para una foto no sirve este camino.
 */
export function prepararParaCalco(img: HTMLImageElement, maxColores = 8): ImagenParaCalco {
  // ── 1. Leer el original ───────────────────────────────────────────────────
  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  const c0 = document.createElement('canvas')
  c0.width = w0; c0.height = h0
  const x0 = c0.getContext('2d', { willReadFrequently: true })!
  x0.drawImage(img, 0, 0)
  const orig = x0.getImageData(0, 0, w0, h0)

  // ── 2. ¿Qué es el fondo? ──────────────────────────────────────────────────
  // Se mira en las cuatro esquinas. Si son transparentes, el fondo es la
  // transparencia; si no, el color que más se repite ahí.
  const esquinas: number[] = []
  const bordes: [number, number][] = [[0, 0], [w0 - 1, 0], [0, h0 - 1], [w0 - 1, h0 - 1]]
  let transparentes = 0
  for (const [ex, ey] of bordes) {
    const p = (ey * w0 + ex) * 4
    if (orig.data[p + 3] < 128) transparentes++
    else esquinas.push(p)
  }
  const fondoTransparente = transparentes >= 3
  let fondo: [number, number, number] = [255, 255, 255]
  if (!fondoTransparente && esquinas.length) {
    let r = 0, g = 0, b = 0
    for (const p of esquinas) { r += orig.data[p]; g += orig.data[p + 1]; b += orig.data[p + 2] }
    fondo = [Math.round(r / esquinas.length), Math.round(g / esquinas.length), Math.round(b / esquinas.length)]
  }

  // ── 3. Aplanar la transparencia sobre el fondo ────────────────────────────
  // Antes de agrandar, porque agrandar mezcla píxeles y un negro invisible
  // contaminaría a sus vecinos.
  const plano = document.createElement('canvas')
  plano.width = w0; plano.height = h0
  const xp = plano.getContext('2d', { willReadFrequently: true })!
  xp.fillStyle = `rgb(${fondo[0]},${fondo[1]},${fondo[2]})`
  xp.fillRect(0, 0, w0, h0)
  xp.drawImage(c0, 0, 0)

  // ── 4. Agrandar si es chico ───────────────────────────────────────────────
  // El detalle fino de un logo chico no sobrevive al calco. Se agranda con
  // suavizado y después se vuelve a endurecer en el paso 5.
  const objetivo = 900
  const lado = Math.min(w0, h0)
  const k = lado >= objetivo ? 1 : Math.min(4, Math.max(1, Math.round(objetivo / Math.max(1, lado))))
  const w = w0 * k, h = h0 * k
  const cg = document.createElement('canvas')
  cg.width = w; cg.height = h
  const xg = cg.getContext('2d', { willReadFrequently: true })!
  xg.imageSmoothingEnabled = true
  xg.imageSmoothingQuality = 'high'
  xg.drawImage(plano, 0, 0, w, h)
  const data = xg.getImageData(0, 0, w, h)

  // ── 5. Pegar cada píxel al color más cercano de la paleta ─────────────────
  // Acá desaparece el borde suavizado: cada píxel pasa a ser uno de los colores
  // de verdad, así que el calcador ve regiones planas con un borde nítido.
  const px = data.data
  const paletaSinFondo = paletaReal(px, w * h, maxColores)
  // El fondo siempre entra en la paleta y va primero, para poder descartarlo
  // después sin tener que adivinar cuál era.
  const paleta: [number, number, number][] = [fondo]
  for (const c of paletaSinFondo) if (dist2(c, fondo) >= 26 * 26) paleta.push(c)

  for (let i = 0; i < px.length; i += 4) {
    let mejor = 0, mejorD = Infinity
    for (let j = 0; j < paleta.length; j++) {
      const d = dist2([px[i], px[i + 1], px[i + 2]], paleta[j])
      if (d < mejorD) { mejorD = d; mejor = j }
    }
    px[i]     = paleta[mejor][0]
    px[i + 1] = paleta[mejor][1]
    px[i + 2] = paleta[mejor][2]
    px[i + 3] = 255
  }

  return { data, paleta, fondo, fondoTransparente }
}

/** ¿Este color es el del fondo (con tolerancia)? */
export function esColorDeFondo(fill: unknown, fondo: [number, number, number]): boolean {
  if (typeof fill !== 'string') return false
  const m = fill.match(/\d+/g)
  if (!m || m.length < 3) return false
  return dist2([Number(m[0]), Number(m[1]), Number(m[2])], fondo) < 30 * 30
}
