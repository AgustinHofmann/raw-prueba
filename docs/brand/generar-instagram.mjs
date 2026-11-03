// Foto de perfil de Instagram.
//
// Dos cosas la diferencian del ícono de la app:
//
// 1. Instagram RECORTA EN CÍRCULO. Por eso el fondo va a sangre (sin esquinas
//    redondeadas): las esquinas se pierden igual, y una baldosa redondeada
//    adentro del círculo se ve como un recorte mal hecho.
// 2. La marca va más chica. En el ícono de 32 px la R ocupa casi todo porque
//    tiene que leerse en una pestaña; en una foto de perfil ese mismo encuadre
//    queda apretado contra el borde del círculo.
//
// Se generan dos opciones para elegir: una con aire y otra con más aire.
import opentype from 'opentype.js'
import { writeFileSync, readFileSync } from 'fs'

const font = opentype.parse(new Uint8Array(readFileSync('C:/Windows/Fonts/georgiaz.ttf')).buffer)

const FONDO = '#1b1d22'
const TINTA = '#f5f5f0'
const VERDE = '#dfff57'
const L = 1080                      // lado de la imagen

// Proporciones del ícono original (public/favicon.svg, lienzo de 32):
//   R centrada en x=15, línea de base y=24, cuerpo 22
//   cuadrado verde en (21.5, 18), de 5x5, esquina 1.2
const SIZE = 22, CX = 15, BASE = 24
const SQ = { x: 21.5, y: 18, w: 5, h: 5, r: 1.2 }

// Trazado de la R, ya centrado como en el original
const anchoR = font.getAdvanceWidth('R', SIZE)
const pR = font.getPath('R', CX - anchoR / 2, BASE, SIZE)
const bb = pR.getBoundingBox()

// La "unidad de marca" es la R junto con el cuadrado: eso es lo que hay que
// centrar, no la R sola (el cuadrado la desbalancea hacia la derecha).
const ux1 = Math.min(bb.x1, SQ.x)
const uy1 = Math.min(bb.y1, SQ.y)
const ux2 = Math.max(bb.x2, SQ.x + SQ.w)
const uy2 = Math.max(bb.y2, SQ.y + SQ.h)
const uw = ux2 - ux1, uh = uy2 - uy1

/**
 * @param nombre  archivo de salida
 * @param ocupa   cuánto del lado de la imagen ocupa la marca (0–1)
 */
function perfil(nombre, ocupa) {
  const escala = (L * ocupa) / Math.max(uw, uh)
  // Centrado por la caja REAL de la marca, no por la del texto: la itálica y el
  // cuadrado tiran el peso a la derecha y centrar por la caja tipográfica deja
  // el dibujo visiblemente corrido.
  const dx = (L - uw * escala) / 2 - ux1 * escala
  const dy = (L - uh * escala) / 2 - uy1 * escala
  writeFileSync(nombre, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${L}" width="${L}" height="${L}" role="img" aria-label="RAW Design">
  <title>RAW Design</title>
  <rect width="${L}" height="${L}" fill="${FONDO}"/>
  <g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${escala.toFixed(4)})">
    <path d="${pR.toPathData(3)}" fill="${TINTA}"/>
    <rect x="${SQ.x}" y="${SQ.y}" width="${SQ.w}" height="${SQ.h}" rx="${SQ.r}" fill="${VERDE}"/>
  </g>
</svg>
`)
  return { ocupa, escala: +escala.toFixed(3) }
}

console.log('A', JSON.stringify(perfil('instagram-A.svg', 0.46)))
console.log('B', JSON.stringify(perfil('instagram-B.svg', 0.34)))
console.log('unidad de marca:', uw.toFixed(2), 'x', uh.toFixed(2))
