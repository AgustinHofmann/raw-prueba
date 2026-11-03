// Rehace los DOS logos del usuario con la tipografia que usa la web.
//
// Sus SVG llevan el texto vivo (<text>), asi que solo se ven bien en una maquina
// que tenga Instrument Serif instalada; en cualquier otra caen a Georgia, que NO
// es lo que muestra la web. Aca se conserva su diseno exacto â€”fondo #1b1d22,
// verde #dfff57, mismas posiciones y tamanosâ€” y lo unico que cambia es que las
// letras pasan a ser trazos de Instrument Serif de verdad.
import opentype from 'opentype.js'
import { writeFileSync, readFileSync } from 'fs'

const DIR = 'C:/Users/agush/Documents/GitHub/raw-prueba/.agents/skills/ui-styling/canvas-fonts/'
const cargar = f => opentype.parse(new Uint8Array(readFileSync(DIR + f)).buffer)
const serif = cargar('InstrumentSerif-Italic.ttf')   // --display de la web
const sans = cargar('Outfit-Regular.ttf')    // para la bajada chica

const FONDO = '#1b1d22'
const TINTA = '#f5f5f0'
const VERDE = '#dfff57'

/** Ancho de un texto con tracking, en unidades del SVG. */
function ancho(font, texto, size, tracking = 0) {
  let w = 0
  for (let i = 0; i < texto.length; i++) {
    w += font.getAdvanceWidth(texto[i], size)
    if (i < texto.length - 1) w += tracking
  }
  return w
}

/**
 * Trazado de un texto: UNA cadena `d` por letra.
 *
 * No se usa `Path.extend()`: juntando varios glifos en un solo trazado, las
 * ultimas letras salian rotas (la bajada se dibujaba "RAW DESI" y se comia la
 * G y la N). Un `<path>` por letra no tiene ese problema y pesa casi lo mismo.
 */
function trazar(font, texto, x, y, size, tracking = 0) {
  const ds = []
  let cur = x
  for (let i = 0; i < texto.length; i++) {
    const d = font.getPath(texto[i], cur, y, size).toPathData(3)
    if (d) ds.push(d)
    cur += font.getAdvanceWidth(texto[i], size)
    if (i < texto.length - 1) cur += tracking
  }
  return ds
}

/** Centrado horizontal, como el text-anchor="middle" de sus archivos. */
function centrado(font, texto, cx, y, size, tracking = 0) {
  const w = ancho(font, texto, size, tracking)
  return trazar(font, texto, cx - w / 2, y, size, tracking)
}

/** Convierte la lista de trazados en elementos <path>. */
const aPaths = (ds, sangria = '  ') => ds.map(d => `${sangria}<path d="${d}"/>`).join('\n')

// â”€â”€ 1. El icono: la R y el punto (32x32, como su "raw design logo.svg") â”€â”€â”€â”€â”€â”€
{
  const R = centrado(serif, 'R', 15, 24, 22)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="32" height="32" rx="7" fill="${FONDO}"/>
  <g fill="${TINTA}">
${aPaths(R, '    ')}
  </g>
  <rect x="21.5" y="18" width="5" height="5" rx="1.2" fill="${VERDE}"/>
</svg>
`
  writeFileSync('web-logo-icono.svg', svg)
}

// â”€â”€ 2. El logotipo completo R.AW (720x280, como su "raw_logo_2d.svg") â”€â”€â”€â”€â”€â”€â”€â”€
{
  const TR = -4                                   // letter-spacing de su archivo
  const R = centrado(serif, 'R', 150, 196, 180, TR)
  const AW = centrado(serif, 'AW', 430, 196, 180, TR)
  const bajada = centrado(sans, 'RAW DESIGN', 360, 248, 20, 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 280" width="720" height="280" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="720" height="280" rx="30" fill="${FONDO}"/>
  <g fill="${TINTA}">
${aPaths([...R, ...AW], '    ')}
  </g>
  <rect x="236" y="86" width="40" height="40" rx="6" fill="${VERDE}"/>
  <g fill="#8a8a80">
${aPaths(bajada, '    ')}
  </g>
</svg>
`
  writeFileSync('web-logo-completo.svg', svg)
}

console.log('listo: web-logo-icono.svg + web-logo-completo.svg')

