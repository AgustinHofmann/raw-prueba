// Mover los puntos de un trazado SVG.
//
// Es la pieza con la que una prenda se vuelve PARAMÉTRICA: en vez de escalar el
// dibujo entero (que la deforma: alargar la remera también la ensancharía), se
// corre cada punto por separado según las medidas.
//
// Vive acá y no dentro de una pantalla porque lo usan las tres prendas.

/** Dónde va a parar un punto del dibujo. */
export type Warp = (x: number, y: number) => [number, number]

/**
 * Devuelve el mismo trazado con todos sus puntos pasados por `W`.
 *
 * Los comandos relativos se pasan a absolutos y las curvas suaves (S, T) se
 * escriben completas: después de mover los puntos, el reflejo que esos comandos
 * dan por sentado deja de valer y la curva saldría torcida.
 */
export function transformPath(d: string, W: Warp): string {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g)
  if (!toks) return d
  let i = 0, cur: [number, number] = [0, 0], start: [number, number] = [0, 0], cmd = ''
  let pc: [number, number] | null = null    // último control de C/S (para reflejar)
  let pq: [number, number] | null = null    // último control de Q/T (para reflejar)
  const out: string[] = []
  const num = () => parseFloat(toks[i++])
  const isCmd = (t: string) => /[a-zA-Z]/.test(t)
  const e = (p: [number, number]) => { const q = W(p[0], p[1]); return `${q[0].toFixed(2)} ${q[1].toFixed(2)}` }

  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++]
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()

    if (C === 'M') {
      let x = num(), y = num()
      if (rel) { x += cur[0]; y += cur[1] }
      cur = [x, y]; start = [x, y]
      out.push('M ' + e(cur)); pc = null; pq = null
      // Un M con más pares seguidos son líneas, no varios "mover".
      while (i < toks.length && !isCmd(toks[i])) {
        let x2 = num(), y2 = num()
        if (rel) { x2 += cur[0]; y2 += cur[1] }
        cur = [x2, y2]; out.push('L ' + e(cur))
      }
    } else if (C === 'L') {
      while (i < toks.length && !isCmd(toks[i])) {
        let x = num(), y = num()
        if (rel) { x += cur[0]; y += cur[1] }
        cur = [x, y]; out.push('L ' + e(cur))
      }
      pc = null; pq = null
    } else if (C === 'H') {
      while (i < toks.length && !isCmd(toks[i])) {
        let x = num(); if (rel) x += cur[0]
        cur = [x, cur[1]]; out.push('L ' + e(cur))
      }
      pc = null; pq = null
    } else if (C === 'V') {
      while (i < toks.length && !isCmd(toks[i])) {
        let y = num(); if (rel) y += cur[1]
        cur = [cur[0], y]; out.push('L ' + e(cur))
      }
      pc = null; pq = null
    } else if (C === 'C') {
      while (i < toks.length && !isCmd(toks[i])) {
        let c1: [number, number] = [num(), num()]
        let c2: [number, number] = [num(), num()]
        let en: [number, number] = [num(), num()]
        if (rel) {
          c1 = [c1[0] + cur[0], c1[1] + cur[1]]
          c2 = [c2[0] + cur[0], c2[1] + cur[1]]
          en = [en[0] + cur[0], en[1] + cur[1]]
        }
        out.push('C ' + e(c1) + ' ' + e(c2) + ' ' + e(en))
        pc = c2; pq = null; cur = en
      }
    } else if (C === 'S') {
      while (i < toks.length && !isCmd(toks[i])) {
        let c2: [number, number] = [num(), num()]
        let en: [number, number] = [num(), num()]
        if (rel) {
          c2 = [c2[0] + cur[0], c2[1] + cur[1]]
          en = [en[0] + cur[0], en[1] + cur[1]]
        }
        const c1: [number, number] = pc ? [2 * cur[0] - pc[0], 2 * cur[1] - pc[1]] : [cur[0], cur[1]]
        out.push('C ' + e(c1) + ' ' + e(c2) + ' ' + e(en))
        pc = c2; pq = null; cur = en
      }
    } else if (C === 'Q') {
      while (i < toks.length && !isCmd(toks[i])) {
        let c: [number, number] = [num(), num()]
        let en: [number, number] = [num(), num()]
        if (rel) { c = [c[0] + cur[0], c[1] + cur[1]]; en = [en[0] + cur[0], en[1] + cur[1]] }
        out.push('Q ' + e(c) + ' ' + e(en))
        pq = c; pc = null; cur = en
      }
    } else if (C === 'T') {
      while (i < toks.length && !isCmd(toks[i])) {
        let en: [number, number] = [num(), num()]
        if (rel) en = [en[0] + cur[0], en[1] + cur[1]]
        const c: [number, number] = pq ? [2 * cur[0] - pq[0], 2 * cur[1] - pq[1]] : [cur[0], cur[1]]
        out.push('Q ' + e(c) + ' ' + e(en))
        pq = c; pc = null; cur = en
      }
    } else if (C === 'A') {
      // Un arco deformado deja de ser un arco (los radios y la inclinación ya no
      // valen). Se parte en pedacitos rectos: es la única forma de que siga el
      // contorno nuevo. Los mockups no usan arcos, pero si alguno los trae no
      // tiene que romperse.
      while (i < toks.length && !isCmd(toks[i])) {
        const rx = num(), ry = num(), rot = num(), grande = num(), barrido = num()
        let en: [number, number] = [num(), num()]
        if (rel) en = [en[0] + cur[0], en[1] + cur[1]]
        for (const p of arcoAPuntos(cur, rx, ry, rot, grande, barrido, en)) out.push('L ' + e(p))
        pc = null; pq = null; cur = en
      }
    } else if (C === 'Z') {
      out.push('Z'); cur = [start[0], start[1]]; pc = null; pq = null
    } else {
      i++
    }
  }
  return out.join(' ')
}

/** Un arco SVG partido en puntos sueltos (ver el comentario del comando A). */
function arcoAPuntos(
  desde: [number, number], rx: number, ry: number, rotDeg: number,
  grande: number, barrido: number, hasta: [number, number],
): [number, number][] {
  if (!rx || !ry) return [hasta]
  const rad = rotDeg * Math.PI / 180
  const cosR = Math.cos(rad), sinR = Math.sin(rad)
  const dx2 = (desde[0] - hasta[0]) / 2, dy2 = (desde[1] - hasta[1]) / 2
  const x1 =  cosR * dx2 + sinR * dy2
  const y1 = -sinR * dx2 + cosR * dy2
  let RX = Math.abs(rx), RY = Math.abs(ry)
  const lam = (x1 * x1) / (RX * RX) + (y1 * y1) / (RY * RY)
  if (lam > 1) { const s = Math.sqrt(lam); RX *= s; RY *= s }
  const num = RX * RX * RY * RY - RX * RX * y1 * y1 - RY * RY * x1 * x1
  const den = RX * RX * y1 * y1 + RY * RY * x1 * x1
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den))
  if (grande === barrido) co = -co
  const cx1 =  co * RX * y1 / RY
  const cy1 = -co * RY * x1 / RX
  const cx = cosR * cx1 - sinR * cy1 + (desde[0] + hasta[0]) / 2
  const cy = sinR * cx1 + cosR * cy1 + (desde[1] + hasta[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    let t = d === 0 ? 1 : (ux * vx + uy * vy) / d
    t = Math.max(-1, Math.min(1, t))
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(t)
  }
  const t1 = ang(1, 0, (x1 - cx1) / RX, (y1 - cy1) / RY)
  let dt = ang((x1 - cx1) / RX, (y1 - cy1) / RY, (-x1 - cx1) / RX, (-y1 - cy1) / RY)
  if (!barrido && dt > 0) dt -= 2 * Math.PI
  if (barrido && dt < 0) dt += 2 * Math.PI
  const pasos = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)))
  const pts: [number, number][] = []
  for (let k = 1; k <= pasos; k++) {
    const t = t1 + dt * (k / pasos)
    const px = cosR * RX * Math.cos(t) - sinR * RY * Math.sin(t) + cx
    const py = sinR * RX * Math.cos(t) + cosR * RY * Math.sin(t) + cy
    pts.push([px, py])
  }
  return pts
}
