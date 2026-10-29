// El ICONO de la app: la R con el punto, tal como se ve en la barra del
// escritorio y en la pestaña del navegador.
//
// Va en GEORGIA BOLD ITALIC y no en Instrument Serif: `public/favicon.svg` y
// `public/icon-maskable.svg` —que son de donde sale ese ícono— piden Georgia
// explícitamente. El logotipo largo R.AW sí usa Instrument Serif, que es lo que
// muestra la barra de la web; son dos tipografías distintas en el producto real.
//
// Las letras se pasan a TRAZOS: los archivos originales llevan el texto vivo,
// así que en una máquina sin Georgia se verían con otra letra.
import opentype from 'opentype.js'
import { writeFileSync, readFileSync } from 'fs'

const GEORGIA_BOLD_ITALIC = 'C:/Windows/Fonts/georgiaz.ttf'
const font = opentype.parse(new Uint8Array(readFileSync(GEORGIA_BOLD_ITALIC)).buffer)

const FONDO = '#1b1d22'
const TINTA = '#f5f5f0'
const VERDE = '#dfff57'

/** Trazado de un texto centrado en `cx`, una cadena `d` por letra. */
function centrado(texto, cx, y, size) {
  let w = 0
  for (const ch of texto) w += font.getAdvanceWidth(ch, size)
  let cur = cx - w / 2
  const ds = []
  for (const ch of texto) {
    const d = font.getPath(ch, cur, y, size).toPathData(3)
    if (d) ds.push(d)
    cur += font.getAdvanceWidth(ch, size)
  }
  return ds
}

const paths = (ds, s = '    ') => ds.map(d => `${s}<path d="${d}"/>`).join('\n')

// ── Ícono normal (32x32), copia exacta de public/favicon.svg ────────────────
{
  const R = centrado('R', 15, 24, 22)
  writeFileSync('web-logo-icono.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="32" height="32" rx="7" fill="${FONDO}"/>
  <g fill="${TINTA}">
${paths(R)}
  </g>
  <rect x="21.5" y="18" width="5" height="5" rx="1.2" fill="${VERDE}"/>
</svg>
`)
}

// ── Ícono grande (512x512) para donde haga falta tamaño ─────────────────────
// Mismas proporciones, escaladas x16, para que no se vea pixelado.
{
  const k = 16
  const R = centrado('R', 15 * k, 24 * k, 22 * k)
  writeFileSync('web-logo-icono-512.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="512" height="512" rx="${7 * k}" fill="${FONDO}"/>
  <g fill="${TINTA}">
${paths(R)}
  </g>
  <rect x="${21.5 * k}" y="${18 * k}" width="${5 * k}" height="${5 * k}" rx="${1.2 * k}" fill="${VERDE}"/>
</svg>
`)
}

console.log('listo: web-logo-icono.svg (32) + web-logo-icono-512.svg')
