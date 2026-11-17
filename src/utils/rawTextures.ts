// Telas que vienen con el programa.
//
// Son fotos y vectores de telas reales, no estampados dibujados por código como
// los de la pestaña de arriba: por eso NO se recolorean. A cambio se ven como la
// tela que son.
//
// Van por el mismo camino que las telas propias del usuario (_userTex): se
// dibujan a escala real según el ancho en cm de la muestra, se combinan con los
// efectos de desgaste y viajan dentro del diseño guardado. La única diferencia
// es que viven en /public/texturas y no en IndexedDB, así que no ocupan lugar en
// la biblioteca del usuario ni se pueden borrar.
//
// El archivo se descarga recién cuando se usa la tela: son varios MB en total y
// no tiene sentido pagarlos al abrir el editor.

export interface RawTexture {
  id: string        // siempre con prefijo 'raw:' — es lo que las distingue
  name: string
  url: string
  // Version chica para la grilla. Existe para que abrir la pestaña de texturas
  // no baje los archivos grandes: son 136 KB las nueve juntas contra 2,8 MB.
  // El archivo pesado se baja recien cuando la tela se aplica de verdad.
  thumb: string
  widthCm: number   // ancho real de la muestra: define la escala del estampado
  // Define cómo se recolorea, y no es un detalle técnico sino lo que el
  // diseñador ve: un vector se edita color por color, una foto se reteñe
  // entera desde un solo color. Ver utils/rawRecolor.ts.
  kind: 'svg' | 'photo'
}

// El ancho en cm es una estimación de fábrica, no un dato del archivo. Es el
// punto de partida; el diseñador lo ajusta con el slider y ese valor sí queda
// guardado (ver loadRawWidths).
// El animal print se sacó (2026-11-16): era un estampado, no un género, y
// ensuciaba la grilla al lado de las telas de verdad. Un proyecto que lo esté
// usando no se rompe: `rawTextureById` devuelve undefined y la pieza se queda
// con el relleno que ya tenía guardado.
export const RAW_TEXTURES: RawTexture[] = [
  { id: 'raw:joggin',   name: 'Joggin',       url: '/texturas/joggin.jpg',       thumb: '/texturas/thumbs/joggin.jpg', widthCm: 15, kind: 'photo' },
  { id: 'raw:camu',     name: 'Camuflaje',    url: '/texturas/camuflaje.svg',    thumb: '/texturas/thumbs/camuflaje.jpg', widthCm: 50, kind: 'svg' },
  { id: 'raw:tartan-1', name: 'Tartán 1',     url: '/texturas/tartan-1.svg',     thumb: '/texturas/thumbs/tartan-1.jpg', widthCm: 15, kind: 'svg' },
  { id: 'raw:tartan-2', name: 'Tartán 2',     url: '/texturas/tartan-2.svg',     thumb: '/texturas/thumbs/tartan-2.jpg', widthCm: 15, kind: 'svg' },
  { id: 'raw:tartan-3', name: 'Tartán 3',     url: '/texturas/tartan-3.svg',     thumb: '/texturas/thumbs/tartan-3.jpg', widthCm: 15, kind: 'svg' },
  { id: 'raw:tartan-4', name: 'Tartán 4',     url: '/texturas/tartan-4.svg',     thumb: '/texturas/thumbs/tartan-4.jpg', widthCm: 15, kind: 'svg' },
  { id: 'raw:tartan-5', name: 'Tartán 5',     url: '/texturas/tartan-5.svg',     thumb: '/texturas/thumbs/tartan-5.jpg', widthCm: 15, kind: 'svg' },
  { id: 'raw:tartan-6', name: 'Tartán 6',     url: '/texturas/tartan-6.svg',     thumb: '/texturas/thumbs/tartan-6.jpg', widthCm: 15, kind: 'svg' },
]

export const rawTextureById = (id: string) => RAW_TEXTURES.find(t => t.id === id)

export const isRawTexture = (id: string) => id.startsWith('raw:')

// El ancho que el diseñador le puso a cada tela de fábrica.
// Va a localStorage y no a IndexedDB porque son nueve números: si alguien decide
// que su leopardo mide 60 cm, no lo tiene que volver a decidir cada vez que abre
// el programa.
const WIDTHS_KEY = 'raw-design:texturas-ancho'

export function loadRawWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY)
    return raw ? JSON.parse(raw) as Record<string, number> : {}
  } catch { return {} }
}

export function saveRawWidth(id: string, widthCm: number): void {
  try {
    const all = loadRawWidths()
    all[id] = widthCm
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(all))
  } catch { /* sin localStorage la app sigue andando, solo no recuerda el ancho */ }
}

// Los colores que el diseñador le puso a cada tela de fábrica. Mismo criterio
// que el ancho: son pocos y se eligen una vez, no cada vez que abre el programa.
// Guarda SOLO los colores elegidos; los originales salen siempre del archivo,
// así una tela que cambie en disco no queda con una paleta vieja pegada.
/* El color de una tela es una decisión DE CADA DISEÑO, no una preferencia del
   programa. Antes se guardaba en una sola bolsa por tela: teñías el camuflaje
   de rosa en un proyecto y aparecía rosa en todos los demás que lo usaran.
   Ahora cada proyecto tiene la suya.

   La bolsa vieja (sin proyecto) se sigue LEYENDO como punto de partida, así
   los diseños que ya estaban pintados no pierden su color; lo que se guarda de
   ahora en más va al proyecto y le gana a la vieja. */
const PALETTE_KEY = 'raw-design:texturas-color'
const clave = (projectId?: string) => projectId ? `${PALETTE_KEY}:${projectId}` : PALETTE_KEY

function leer(k: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(k)
    return raw ? JSON.parse(raw) as Record<string, string[]> : {}
  } catch { return {} }
}

export function loadRawPalettes(projectId?: string): Record<string, string[]> {
  const heredadas = leer(PALETTE_KEY)                        // las de antes, comunes
  if (!projectId) return heredadas
  return { ...heredadas, ...leer(clave(projectId)) }         // las del proyecto mandan
}

export function saveRawPalette(projectId: string | undefined, id: string, colors: string[] | null): void {
  try {
    const k = clave(projectId)
    const all = leer(k)
    if (colors) all[id] = colors
    else delete all[id]                 // volver al original = no guardar nada
    localStorage.setItem(k, JSON.stringify(all))
  } catch { /* idem */ }
}
