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

// ── Isotipo: la R y el punto, sin el AW ──────────────────────────────────────
//
// Es la marca corta — la que entra en una pestaña del navegador, en un avatar o
// en una esquina. El logotipo completo a 16 px no se lee; este sí.
//
// Mismas proporciones que el completo: no es un dibujo aparte, es el mismo logo
// recortado. Por eso reusa `pR` y el cuadrado tal cual están.
const isoMinX = Math.min(bbR.x1, xR)
const isoMaxX = xCuadrado + CUADRADO
const isoMinY = Math.min(bbR.y1, cuadradoTop)
const isoMaxY = Math.max(bbR.y2, cuadradoBottom)

const ivbX = isoMinX - MARGEN
const ivbY = isoMinY - MARGEN
const ivbW = (isoMaxX - isoMinX) + MARGEN * 2
const ivbH = (isoMaxY - isoMinY) + MARGEN * 2

function isotipo(tinta) {
  const r = 0.0125 * SIZE
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ivbX.toFixed(2)} ${ivbY.toFixed(2)} ${ivbW.toFixed(2)} ${ivbH.toFixed(2)}" width="${Math.round(ivbW)}" height="${Math.round(ivbH)}" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <path d="${pR.toPathData(3)}" fill="${tinta}"/>
  <rect x="${xCuadrado.toFixed(2)}" y="${cuadradoTop.toFixed(2)}" width="${CUADRADO.toFixed(2)}" height="${CUADRADO.toFixed(2)}" rx="${r.toFixed(2)}" fill="${ACENTO}"/>
</svg>
`
}

/**
 * Isotipo dentro de una baldosa redondeada: el ícono de la app.
 *
 * Va centrado por su CAJA REAL, no por la del texto. La itálica y el cuadrado
 * tiran el peso a la derecha, así que centrar por la caja tipográfica deja el
 * dibujo visiblemente corrido.
 */
function baldosa(fondo = TINTA_CLARA, tinta = TINTA_OSCURA) {
  const L = 32                       // lienzo del ícono
  const margen = 0.18 * L            // aire alrededor del dibujo
  const util = L - margen * 2
  const escala = Math.min(util / ivbW, util / ivbH)
  const dx = (L - ivbW * escala) / 2 - ivbX * escala
  const dy = (L - ivbH * escala) / 2 - ivbY * escala
  const r = 0.0125 * SIZE
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${L}" width="${L}" height="${L}" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="${L}" height="${L}" rx="7" fill="${fondo}"/>
  <g transform="translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${escala.toFixed(4)})">
    <path d="${pR.toPathData(3)}" fill="${tinta}"/>
    <rect x="${xCuadrado.toFixed(2)}" y="${cuadradoTop.toFixed(2)}" width="${CUADRADO.toFixed(2)}" height="${CUADRADO.toFixed(2)}" rx="${r.toFixed(2)}" fill="${ACENTO}"/>
  </g>
</svg>
`
}

writeFileSync('logo-raw-isotipo.svg', isotipo(TINTA_CLARA))
writeFileSync('logo-raw-isotipo-fondo-oscuro.svg', isotipo(TINTA_OSCURA))
writeFileSync('logo-raw-icono.svg', baldosa())

console.log('viewBox:', vbX.toFixed(1), vbY.toFixed(1), vbW.toFixed(1), vbH.toFixed(1))
console.log('ancho total:', anchoTotal.toFixed(1), '| R:', anchoR.toFixed(1), '| AW:', anchoAW.toFixed(1))
console.log('isotipo viewBox:', ivbX.toFixed(1), ivbY.toFixed(1), ivbW.toFixed(1), ivbH.toFixed(1))
console.log('listo: logotipo (2) + isotipo (2) + icono (1)')
