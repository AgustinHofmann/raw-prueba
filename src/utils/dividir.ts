// Partir una pieza de la prenda con un trazo.
//
// La idea: el diseñador dibuja una línea que cruza la prenda de punta a punta y
// pide dividir. A partir de ahí cada lado es una pieza aparte, con su color y
// su tela.
//
// Se trabaja con POLÍGONOS, no con curvas: cada pieza se aplana en muchos
// puntitos antes de cortar. A este paso de muestreo la diferencia no se ve, y
// evita tener que resolver intersecciones entre curvas, que es donde este tipo
// de cosas se rompe.

export type Punto = [number, number]

/**
 * Convierte un trazado en una lista de puntos.
 *
 * Solo entiende M, L, C, Q y Z, que es exactamente lo que emite `transformPath`
 * después de deformar una prenda.
 */
export function aplanarPath(d: string, paso = 2.5): Punto[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g)
  if (!toks) return []
  const pts: Punto[] = []
  let i = 0, cmd = ''
  let cx = 0, cy = 0, sx = 0, sy = 0
  const num = () => parseFloat(toks[i++])
  const esCmd = (t: string) => /[a-zA-Z]/.test(t)
  const meter = (x: number, y: number) => {
    const u = pts[pts.length - 1]
    if (!u || Math.hypot(x - u[0], y - u[1]) > 1e-4) pts.push([x, y])
  }
  const cubica = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const largo = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)
    const n = Math.max(2, Math.ceil(largo / paso))
    for (let k = 1; k <= n; k++) {
      const t = k / n, m = 1 - t
      meter(
        m*m*m*cx + 3*m*m*t*x1 + 3*m*t*t*x2 + t*t*t*x3,
        m*m*m*cy + 3*m*m*t*y1 + 3*m*t*t*y2 + t*t*t*y3,
      )
    }
    cx = x3; cy = y3
  }
  const cuadratica = (x1: number, y1: number, x2: number, y2: number) => {
    const largo = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(2, Math.ceil(largo / paso))
    for (let k = 1; k <= n; k++) {
      const t = k / n, m = 1 - t
      meter(m*m*cx + 2*m*t*x1 + t*t*x2, m*m*cy + 2*m*t*y1 + t*t*y2)
    }
    cx = x2; cy = y2
  }
  while (i < toks.length) {
    if (esCmd(toks[i])) cmd = toks[i++]
    const C = cmd.toUpperCase()
    if (C === 'M')      { cx = sx = num(); cy = sy = num(); meter(cx, cy) }
    else if (C === 'L') { cx = num(); cy = num(); meter(cx, cy) }
    else if (C === 'C') { cubica(num(), num(), num(), num(), num(), num()) }
    else if (C === 'Q') { cuadratica(num(), num(), num(), num()) }
    else if (C === 'Z') { cx = sx; cy = sy }
    else i++
  }
  return pts
}

/** El trazado de un polígono cerrado. */
export function poligonoAPath(p: Punto[]): string {
  if (p.length < 3) return ''
  return 'M ' + p.map(q => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(' L ') + ' Z'
}

/** Dónde se cruzan dos segmentos. `null` si no se cruzan. */
function cruce(a: Punto, b: Punto, c: Punto, d: Punto): { t: number; u: number; p: Punto } | null {
  const rx = b[0] - a[0], ry = b[1] - a[1]
  const sx = d[0] - c[0], sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12) return null            // paralelos
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { t, u, p: [a[0] + rx * t, a[1] + ry * t] }
}

/** El pedazo del trazo de corte que va de un cruce al otro. */
function tramoDelCorte(corte: Punto[], iA: number, uA: number, iB: number, uB: number): Punto[] {
  const pA: Punto = [
    corte[iA][0] + (corte[iA + 1][0] - corte[iA][0]) * uA,
    corte[iA][1] + (corte[iA + 1][1] - corte[iA][1]) * uA,
  ]
  const pB: Punto = [
    corte[iB][0] + (corte[iB + 1][0] - corte[iB][0]) * uB,
    corte[iB][1] + (corte[iB + 1][1] - corte[iB][1]) * uB,
  ]
  const medio: Punto[] = []
  for (let k = iA + 1; k <= iB; k++) medio.push(corte[k])
  return [pA, ...medio, pB]
}

/**
 * Parte un polígono en dos con un trazo abierto que lo cruza de lado a lado.
 *
 * Devuelve `null` si el trazo no lo cruza exactamente dos veces, que es la
 * forma de decir "este trazo no divide nada": o no llega de punta a punta, o
 * entra y sale varias veces y no hay dos mitades claras.
 */
export function partirPoligono(poly: Punto[], corte: Punto[]): [Punto[], Punto[]] | null {
  if (poly.length < 3 || corte.length < 2) return null

  type Cruce = { iPoly: number; tPoly: number; iCorte: number; uCorte: number; p: Punto }
  const cruces: Cruce[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    for (let j = 0; j < corte.length - 1; j++) {
      const x = cruce(a, b, corte[j], corte[j + 1])
      if (x) cruces.push({ iPoly: i, tPoly: x.t, iCorte: j, uCorte: x.u, p: x.p })
    }
  }
  if (cruces.length < 2) return null

  // Con el borde muestreado en muchos puntitos, un mismo cruce puede aparecer
  // dos veces (justo en un vértice). Se juntan los que caen casi encima.
  const unicos: Cruce[] = []
  for (const c of cruces) {
    if (!unicos.some(u => Math.hypot(u.p[0] - c.p[0], u.p[1] - c.p[1]) < 0.5)) unicos.push(c)
  }
  if (unicos.length !== 2) return null

  unicos.sort((a, b) => (a.iPoly - b.iPoly) || (a.tPoly - b.tPoly))
  const [h1, h2] = unicos

  // Lado A: del primer cruce al segundo por el borde, y la vuelta por el trazo.
  const ladoA: Punto[] = [h1.p]
  for (let k = h1.iPoly + 1; k <= h2.iPoly; k++) ladoA.push(poly[k % poly.length])
  ladoA.push(h2.p)

  // Lado B: el resto del borde.
  const ladoB: Punto[] = [h2.p]
  for (let k = h2.iPoly + 1; k <= h1.iPoly + poly.length; k++) ladoB.push(poly[k % poly.length])
  ladoB.push(h1.p)

  // El trazo de corte cierra las dos mitades, cada una en su sentido.
  const derecho = h1.iCorte < h2.iCorte || (h1.iCorte === h2.iCorte && h1.uCorte <= h2.uCorte)
  const tramo = derecho
    ? tramoDelCorte(corte, h1.iCorte, h1.uCorte, h2.iCorte, h2.uCorte)
    : tramoDelCorte(corte, h2.iCorte, h2.uCorte, h1.iCorte, h1.uCorte).reverse()

  const interior = tramo.slice(1, -1)
  const A = [...ladoA, ...interior.slice().reverse()]
  const B = [...ladoB, ...interior]

  if (A.length < 3 || B.length < 3) return null
  if (areaDe(A) < 4 || areaDe(B) < 4) return null    // una mitad casi sin superficie
  return [A, B]
}

export function areaDe(p: Punto[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i][0] * q[1] - q[0] * p[i][1]
  }
  return Math.abs(a) / 2
}
