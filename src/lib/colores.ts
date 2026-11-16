/** Los colores con que se pide la tela al proveedor, con el nombre del taller. */
export const COLORES_PRENDA: { nombre: string; hex: string }[] = [
  { nombre: 'Blanco',        hex: '#f4f4f1' },
  { nombre: 'Crudo',         hex: '#e9e2d0' },
  { nombre: 'Gris melange',  hex: '#a3a3a1' },
  { nombre: 'Gris topo',     hex: '#5c5853' },
  { nombre: 'Negro',         hex: '#1d1d1b' },
  { nombre: 'Azul marino',   hex: '#1f2a44' },
  { nombre: 'Azul francia',  hex: '#2f5bb7' },
  { nombre: 'Celeste',       hex: '#75aadb' },
  { nombre: 'Verde inglés',  hex: '#1f4d3a' },
  { nombre: 'Verde militar', hex: '#5b6b3a' },
  { nombre: 'Bordó',         hex: '#6b1f2a' },
  { nombre: 'Rojo',          hex: '#b3262e' },
]

/** '#abc', '#aabbcc' o 'rgb(…)' → [r, g, b]; cualquier otra cosa → null. */
export function aRgb(c: string | null | undefined): [number, number, number] | null {
  if (!c) return null
  const s = c.trim().toLowerCase()
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
  if (m) return [+m[1], +m[2], +m[3]]
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1]
  if (!h) return null
  const n = h.length === 3 ? h.split('').map(x => x + x).join('') : h
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

export const aHex = ([r, g, b]: [number, number, number]) =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

/**
 * CMYK por la fórmula simple, sin perfil de color. Sirve de referencia para
 * hablar con la imprenta, no para igualar: el número exacto sale de la prueba
 * de color sobre la tela.
 */
export function aCmyk([r, g, b]: [number, number, number]): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255
  if (k >= 1) return [0, 0, 0, 100]
  const f = (v: number) => Math.round(((1 - v / 255 - k) / (1 - k)) * 100)
  return [f(r), f(g), f(b), Math.round(k * 100)]
}

/**
 * El nombre de la paleta del taller, si el color ES uno de ellos (o casi: una
 * diferencia que a ojo no se ve). Si no, null: es mejor no nombrarlo que
 * llamarlo "Rojo" cuando es otro rojo.
 */
export function nombreDeColor(c: string | null | undefined): string | null {
  const rgb = aRgb(c)
  if (!rgb) return null
  let mejor: { nombre: string; d: number } | null = null
  for (const p of COLORES_PRENDA) {
    const q = aRgb(p.hex)!
    const d = Math.hypot(rgb[0] - q[0], rgb[1] - q[1], rgb[2] - q[2])
    if (!mejor || d < mejor.d) mejor = { nombre: p.nombre, d }
  }
  return mejor && mejor.d <= 12 ? mejor.nombre : null
}
