// Recoloreo de las telas de fábrica.
//
// Son dos problemas distintos y por eso hay dos caminos:
//
// - Un SVG tiene los colores escritos adentro, uno por uno. Se pueden leer,
//   listar y reemplazar exacto: el tartán rojo se vuelve verde y el hilo blanco
//   sigue blanco. Editable color por color.
// - Una foto no tiene "colores", tiene millones de píxeles distintos. Ahí lo
//   único honesto es reteñir: se calcula cuánto hay que mover el color dominante
//   para llegar al elegido y ese mismo desplazamiento se aplica a toda la foto.
//   Por eso las fotos tienen un solo color y no una paleta.

// ── Color: hex <-> HSL ───────────────────────────────────────────────────────
export function hexToHsl(hex: string): [number, number, number] {
  const h0 = hex.replace('#', '')
  const r = parseInt(h0.slice(0, 2), 16) / 255
  const g = parseInt(h0.slice(2, 4), 16) / 255
  const b = parseInt(h0.slice(4, 6), 16) / 255
  return rgbToHsl(r, g, b)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// ── SVG: leer y reemplazar los colores ───────────────────────────────────────

// Los colores aparecen de dos formas según cómo exportó Illustrator:
// fill="#A01F24" y style="fill:#A01F24;". Hay que agarrar las dos.
const HEX_RE = /#([0-9a-fA-F]{6})\b/g

/** Los colores distintos que usa un SVG, en el orden en que aparecen. */
export function readSvgColors(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(HEX_RE)) {
    const hex = '#' + m[1].toLowerCase()
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
  }
  return out
}

/**
 * Ordena los colores por cuánta superficie ocupan de verdad, dibujando la tela
 * chiquita y contando píxeles. Contar cuántas veces aparece cada color en el
 * texto no sirve: el fondo de un tartán es UN rectángulo que tapa media tela,
 * y una raya fina puede estar repetida cincuenta veces.
 */
export async function sortColorsByArea(url: string, colors: string[]): Promise<string[]> {
  try {
    const img = await loadImage(url)
    const S = 64
    const c = document.createElement('canvas'); c.width = S; c.height = S
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.drawImage(img, 0, 0, S, S)
    const px = x.getImageData(0, 0, S, S).data

    const rgb = colors.map(h => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
    ] as [number, number, number])
    const count = new Array(colors.length).fill(0)

    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue
      let best = -1, bestD = Infinity
      for (let k = 0; k < rgb.length; k++) {
        const dr = px[i] - rgb[k][0], dg = px[i + 1] - rgb[k][1], db = px[i + 2] - rgb[k][2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) { bestD = d; best = k }
      }
      if (best >= 0) count[best]++
    }
    return colors
      .map((hex, i) => ({ hex, n: count[i] }))
      .sort((a, b) => b.n - a.n)
      .map(o => o.hex)
  } catch {
    return colors     // si no se puede medir, al menos que se puedan editar
  }
}

/** Reemplaza cada color por el nuevo. Devuelve el SVG listo para dibujar. */
export function recolorSvg(text: string, from: string[], to: string[]): string {
  const map = new Map<string, string>()
  from.forEach((f, i) => { if (to[i]) map.set(f.toLowerCase(), to[i]) })
  return text.replace(HEX_RE, m => map.get(m.toLowerCase()) ?? m)
}

/**
 * Mueve la paleta entera a partir de un solo color.
 *
 * Es lo que hace el "color principal": el diseñador elige el color que manda y
 * el resto de los hilos lo acompañan con el mismo desplazamiento. Un tartán
 * rojo pasa a ser el mismo tartán en verde, y no un tartán verde con las rayas
 * del rojo. Los grises y los negros (saturación cero) no se mueven, porque
 * multiplicar cero por cualquier cosa sigue siendo cero.
 */
export function shiftPalette(source: string[], mainIdx: number, newMain: string): string[] {
  const [fh, fs, fl] = hexToHsl(source[mainIdx])
  const [th, ts, tl] = hexToHsl(newMain)
  const dh = th - fh, dl = tl - fl
  const sMul = fs > 0.01 ? ts / fs : 1

  return source.map((hex, i) => {
    if (i === mainIdx) return newMain
    const [h, s, l] = hexToHsl(hex)
    const peso = 1 - Math.abs(2 * l - 1)
    const [r, g, b] = hslToRgb(
      fs < 0.01 ? th : (h + dh + 1) % 1,
      clamp01(fs < 0.01 ? ts : s * sMul),
      clamp01(l + dl * peso),
    )
    const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
    return `#${to(r)}${to(g)}${to(b)}`
  })
}

export const sameColors = (a: string[] | undefined, b: string[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase())

// ── Fotos: reteñir ───────────────────────────────────────────────────────────

/**
 * El color que más manda en una foto. Se agrupa en cubos gruesos y gana el más
 * poblado, ignorando lo casi negro y lo casi blanco: en un animal print el que
 * define la tela es el fondo, no las manchas.
 */
export function dominantColor(img: HTMLImageElement): string {
  const S = 64
  const c = document.createElement('canvas'); c.width = S; c.height = S
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(img, 0, 0, S, S)
  const px = x.getImageData(0, 0, S, S).data

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue
    const r = px[i], g = px[i + 1], b = px[i + 2]
    const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255
    if (l < 0.12 || l > 0.94) continue           // negros y blancos no definen la tela
    const key = (r >> 4 << 8) | (g >> 4 << 4) | (b >> 4)
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    cur.n++; cur.r += r; cur.g += g; cur.b += b
    buckets.set(key, cur)
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v
  if (!best) return '#808080'
  const to = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0')
  return `#${to(best.r)}${to(best.g)}${to(best.b)}`
}

/** Cuánto se achica la foto para reteñirla. Un tile nunca se dibuja más grande. */
const TINT_MAX = 512

/**
 * Reteñe la foto: mueve el color dominante hasta el elegido y aplica ese mismo
 * desplazamiento a cada píxel.
 *
 * Dos detalles que hacen que se vea como tela y no como un filtro de Instagram:
 *
 * - La saturación se ESCALA, no se fija. Así las manchas negras del leopardo
 *   siguen negras (saturación cero por cualquier número sigue siendo cero) y
 *   solo cambia el fondo, que es lo que uno quiere cambiar.
 * - El cambio de claridad se apaga en los extremos. Si no, elegir un color
 *   oscuro aplastaba los negros contra el negro y la tela perdía el dibujo.
 *
 * Con una tela gris (un joggin) el desplazamiento de tono no alcanza, porque no
 * hay tono de dónde partir: ahí se tiñe de verdad, fijando el tono y la
 * saturación del color elegido y conservando la variación de luz de la foto.
 */
export function tintImage(img: HTMLImageElement, from: string, to: string): HTMLCanvasElement {
  const ratio = img.naturalHeight / img.naturalWidth || 1
  const w = Math.min(TINT_MAX, img.naturalWidth || TINT_MAX)
  const h = Math.max(1, Math.round(w * ratio))

  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(img, 0, 0, w, h)

  const [fh, fs, fl] = hexToHsl(from)
  const [th, ts, tl] = hexToHsl(to)
  const neutral = fs < 0.12                    // la tela de origen no tiene color propio
  const dh = th - fh, dl = tl - fl
  const sMul = fs > 0.01 ? ts / fs : 1

  const data = x.getImageData(0, 0, w, h)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    const [ph, ps, pl] = rgbToHsl(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255)

    const nh = neutral ? th : (ph + dh + 1) % 1
    const ns = neutral ? ts : clamp01(ps * sMul)
    // El peso apaga el cambio en negros y blancos puros y lo aplica entero en
    // los medios tonos, que es donde vive el color de la tela.
    const peso = 1 - Math.abs(2 * pl - 1)
    const nl = clamp01(pl + dl * peso)

    const [r, g, b] = hslToRgb(nh, ns, nl)
    px[i] = Math.round(r * 255); px[i + 1] = Math.round(g * 255); px[i + 2] = Math.round(b * 255)
  }
  x.putImageData(data, 0, 0)
  return c
}

// ── Utilidades ───────────────────────────────────────────────────────────────

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
    img.src = src
  })
}

export const svgToDataUrl = (text: string) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
