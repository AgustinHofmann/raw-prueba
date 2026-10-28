import opentype from 'opentype.js'
import { writeFileSync, readFileSync } from 'fs'

const FUENTE = 'C:/Users/agush/Documents/GitHub/raw-prueba/.agents/skills/ui-styling/canvas-fonts/InstrumentSerif-Italic.ttf'

// Identidad real de la app (docs/landing-brief/02-identidad-visual.md)
const ACENTO = '#bbec4d'
const TINTA_CLARA = '#0b0c0f'   // --bg, para logo sobre fondo claro
const TINTA_OSCURA = '#f6f5f1'  // --fg, para logo sobre fondo oscuro

const buf = readFileSync(FUENTE)
const font = opentype.parse(new Uint8Array(buf).buffer)

const SIZE = 200                       // tamano de dibujo de los glifos
const TRACKING = -0.02 * SIZE          // letter-spacing: -0.02em
const CUADRADO = 0.18 * SIZE           // el cuadrado del logo = 18% del tamano
const HUECO = 0.18 * SIZE              // gap: 4px a size 22 => 0.18em
const SUBIDA = 0.0909 * SIZE           // translateY(-2px) a size 22

/** Ancho de un texto con el tracking de la marca aplicado entre letras. */
function ancho(texto) {
  let w = 0
  for (let i = 0; i < texto.length; i++) {
    w += font.getAdvanceWidth(texto[i], SIZE)
    if (i < texto.length - 1) w += TRACKING
  }
  return w
}

/** Trazado de un texto, letra por letra, respetando el tracking. */
function trazado(texto, x, y) {
  const p = new opentype.Path()
  let cursor = x
  for (let i = 0; i < texto.length; i++) {
    const glifo = font.getPath(texto[i], cursor, y, SIZE)
    p.extend(glifo)
    cursor += font.getAdvanceWidth(texto[i], SIZE)
    if (i < texto.length - 1) cursor += TRACKING
  }
  return p
}

// ── Composicion: R [cuadrado] AW, todo apoyado en la misma linea de base ─────
const anchoR = ancho('R')
const anchoAW = ancho('AW')

const xR = 0
const xCuadrado = xR + anchoR + HUECO
const xAW = xCuadrado + CUADRADO + HUECO
const anchoTotal = xAW + anchoAW

const baseY = 0
const pR = trazado('R', xR, baseY)
const pAW = trazado('AW', xAW, baseY)

// Caja real del dibujo, para recortar el SVG sin aire de sobra
const bbR = pR.getBoundingBox()
const bbAW = pAW.getBoundingBox()
const cuadradoTop = baseY - SUBIDA - CUADRADO
const cuadradoBottom = baseY - SUBIDA

const minX = Math.min(bbR.x1, bbAW.x1, xCuadrado)
const maxX = Math.max(bbR.x2, bbAW.x2, xCuadrado + CUADRADO)
const minY = Math.min(bbR.y1, bbAW.y1, cuadradoTop)
const maxY = Math.max(bbR.y2, bbAW.y2, cuadradoBottom)

const MARGEN = 0.04 * SIZE
const vbX = minX - MARGEN
const vbY = minY - MARGEN
const vbW = (maxX - minX) + MARGEN * 2
const vbH = (maxY - minY) + MARGEN * 2

function svg(tinta) {
  const r = 0.0125 * SIZE   // borderRadius: 2px a size 22, proporcional
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" width="${Math.round(vbW)}" height="${Math.round(vbH)}" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <g fill="${tinta}">
    <path d="${pR.toPathData(3)}"/>
    <path d="${pAW.toPathData(3)}"/>
  </g>
  <rect x="${xCuadrado.toFixed(2)}" y="${cuadradoTop.toFixed(2)}" width="${CUADRADO.toFixed(2)}" height="${CUADRADO.toFixed(2)}" rx="${r.toFixed(2)}" fill="${ACENTO}"/>
</svg>
`
}

writeFileSync('logo-raw-design.svg', svg(TINTA_CLARA))
writeFileSync('logo-raw-design-fondo-oscuro.svg', svg(TINTA_OSCURA))

console.log('viewBox:', vbX.toFixed(1), vbY.toFixed(1), vbW.toFixed(1), vbH.toFixed(1))
console.log('ancho total:', anchoTotal.toFixed(1), '| R:', anchoR.toFixed(1), '| AW:', anchoAW.toFixed(1))
console.log('listo: logo-raw-design.svg + logo-raw-design-fondo-oscuro.svg')
