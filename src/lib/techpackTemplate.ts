import type {
  Project, TechPackDoc, TechPackPage, TechPackPageKind,
  BomRow, PomRow, TechPackImageSlot, ImageRole,
} from '../types/project'

const uid = () => crypto.randomUUID()

// Catálogo de páginas disponibles (título por defecto)
export const PAGE_CATALOG: { kind: TechPackPageKind; title: string }[] = [
  { kind: 'design',    title: 'Diseño' },
  { kind: 'prints',    title: 'Estampados y colores' },
  { kind: 'specs',     title: 'Especificaciones' },
  { kind: 'measures',  title: 'Tabla de medidas' },
  { kind: 'materials', title: 'Materiales' },
  { kind: 'colorways', title: 'Colorways' },
  { kind: 'notes',     title: 'Notas' },
]

// Páginas por defecto de una ficha nueva (orden típico de fábrica)
const DEFAULT_PAGES: TechPackPageKind[] = ['design', 'prints', 'specs', 'measures', 'materials']

const GARMENT_NAMES: Record<Project['mockupId'], string> = {
  tshirt: 'Remera', chomba: 'Chomba', pants: 'Pantalón',
  musculosa: 'Musculosa', short: 'Short deportivo',
}
export const garmentName = (mockupId: Project['mockupId']) => GARMENT_NAMES[mockupId] ?? 'Prenda'

const titleOf = (kind: TechPackPageKind) => PAGE_CATALOG.find(p => p.kind === kind)?.title ?? kind

function defaultBody(kind: TechPackPageKind, mockupId: Project['mockupId']): string {
  if (kind === 'specs') {
    return mockupId === 'pants'
      ? 'Construcción: doble pespunte en tiro y entrepierna · Cintura con elástico/pretina · Ruedo dobladillo 2 cm · Bolsillos según diseño.'
      : mockupId === 'musculosa'
      ? 'Construcción: escote con collarete ribb 1x1 · Sisas rematadas con vivo al tono · Hombro caído con costura reforzada · Costados overlock con abertura de 9 cm en el ruedo · Ruedo con recubridora · Etiqueta interior en cuello CB.'
      : mockupId === 'short'
      ? 'Construcción: cintura con elástico de 4 cm y cordón interno · Vivos laterales aplicados antes de cerrar el costado · Tiro y entrepierna con doble pespunte · Ruedo con recubridora · Etiqueta interior en cintura CB.'
      : mockupId === 'chomba'
      ? 'Construcción: cuello tejido piqué · Tapeta con entretela y 3 botones · Costuras de unión overlock · Ruedos con recubridora · Hombro reforzado con cinta · Etiqueta interior en cuello CB.'
      : 'Construcción: cuello ribb 1x1 · Costuras de unión overlock · Ruedos con recubridora · Hombro reforzado con cinta · Etiqueta interior en cuello CB.'
  }
  if (kind === 'notes') return 'Observaciones generales para el taller.'
  return ''
}

// ─── BOM por tipo de prenda ──────────────────────────────────────────────────
function defaultBom(mockupId: Project['mockupId'], colors: string[]): BomRow[] {
  const dtm = colors[0] ?? ''
  const base: Omit<BomRow, 'id'>[] = [
    { categoria: 'Tela',     descripcion: 'Tela principal — jersey algodón 180 GSM', placement: 'Cuerpo', composicion: '100% algodón', color: dtm, proveedor: '', consumo: '', uom: 'm', notas: '' },
    { categoria: 'Hilo',     descripcion: 'Hilo — poliéster tono a tono',            placement: 'General', composicion: '100% poliéster', color: dtm, proveedor: '', consumo: '', uom: 'u', notas: '' },
    { categoria: 'Etiqueta', descripcion: 'Etiqueta de marca — tejida',             placement: 'Cuello CB', composicion: '', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
    { categoria: 'Etiqueta', descripcion: 'Etiqueta de cuidado',                    placement: 'Costado izq.', composicion: '', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
  ]
  if (mockupId === 'chomba') {
    base.push(
      { categoria: 'Tela', descripcion: 'Piqué para cuello tejido', placement: 'Cuello y puños', composicion: '100% algodón', color: dtm, proveedor: '', consumo: '', uom: 'u', notas: '' },
      { categoria: 'Trim', descripcion: 'Botones de tapeta',        placement: 'Tapeta delantera', composicion: '', color: '', proveedor: '', consumo: '3', uom: 'u', notas: '' },
      { categoria: 'Trim', descripcion: 'Entretela de tapeta',      placement: 'Tapeta delantera', composicion: '', color: '', proveedor: '', consumo: '', uom: 'u', notas: '' },
    )
  } else if (mockupId === 'musculosa') {
    base.push(
      { categoria: 'Tela', descripcion: 'Ribb 1x1 para collarete', placement: 'Escote', composicion: '95% algodón 5% elastano', color: dtm, proveedor: '', consumo: '', uom: 'm', notas: '' },
      { categoria: 'Tela', descripcion: 'Vivo de sisa al tono',    placement: 'Sisas', composicion: '95% algodón 5% elastano', color: dtm, proveedor: '', consumo: '', uom: 'm', notas: '' },
    )
  } else if (mockupId === 'short') {
    base.push(
      { categoria: 'Trim', descripcion: 'Elástico 4 cm',        placement: 'Cintura', composicion: '', color: '', proveedor: '', consumo: '', uom: 'cm', notas: '' },
      { categoria: 'Trim', descripcion: 'Cordón interno',       placement: 'Cintura', composicion: '100% poliéster', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
      { categoria: 'Tela', descripcion: 'Vivo lateral contraste', placement: 'Costados', composicion: '100% poliéster', color: '', proveedor: '', consumo: '', uom: 'm', notas: '' },
    )
  } else if (mockupId === 'pants') {
    base.push(
      { categoria: 'Trim', descripcion: 'Elástico / pretina', placement: 'Cintura', composicion: '', color: '', proveedor: '', consumo: '', uom: 'cm', notas: '' },
      { categoria: 'Trim', descripcion: 'Cierre #4',          placement: 'Tiro delantero', composicion: '', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
      { categoria: 'Trim', descripcion: 'Botón / remache',    placement: 'Cintura', composicion: '', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
    )
  }
  return base.map(r => ({ ...r, id: uid() }))
}

// ─── POM por tipo de prenda ──────────────────────────────────────────────────
const BASE_POMS: { code: string; punto: string; key: string; htm: string; tol: string }[] = [
  { code: 'A', punto: 'Largo total',           key: 'largoTotal',        htm: 'Desde HPS hasta ruedo',       tol: '1' },
  { code: 'B', punto: 'Ancho de pecho',        key: 'anchoPecho',        htm: '2.5 cm bajo sisa, plano',     tol: '1' },
  { code: 'C', punto: 'Ancho de cintura',      key: 'anchoCintura',      htm: 'Punto más angosto, plano',    tol: '1' },
  { code: 'D', punto: 'Ancho de cuello',       key: 'anchoCuello',       htm: 'Interior costura a costura',  tol: '0.5' },
  { code: 'E', punto: 'Profundidad de cuello', key: 'profundidadCuello', htm: 'Desde HPS a base del cuello', tol: '0.5' },
  { code: 'F', punto: 'Largo de manga',        key: 'largoManga',        htm: 'Desde hombro a boca de manga', tol: '0.5' },
  { code: 'G', punto: 'Ancho de manga',        key: 'anchoManga',        htm: 'Plano en la sisa',            tol: '0.5' },
]

// `key` es la medida de la prenda que llena la columna Base. Las filas que no
// la tienen (las que se miden sobre la prenda cosida, como el tiro) se cargan
// a mano en el taller.
const EXTRA_POMS: Record<Project['mockupId'], { code: string; punto: string; htm: string; tol: string; key?: string }[]> = {
  tshirt: [],
  chomba: [
    { code: 'H', punto: 'Alto de cuello',    htm: 'Costura a borde',   tol: '0.5' },
    { code: 'I', punto: 'Largo de tapeta',   htm: 'Escote a punta',    tol: '0.5' },
    { code: 'J', punto: 'Ancho de tapeta',   htm: 'Plano',             tol: '0.3' },
    { code: 'K', punto: 'Alto de puño',      htm: 'Borde a costura',   tol: '0.5' },
  ],
  musculosa: [
    { code: 'A', punto: 'Largo total',           htm: 'Desde HPS hasta ruedo',      tol: '1',   key: 'largoTotal' },
    { code: 'B', punto: 'Ancho de pecho',        htm: '2.5 cm bajo sisa, plano',    tol: '1',   key: 'anchoPecho' },
    { code: 'C', punto: 'Ancho de cintura',      htm: 'Punto más angosto, plano',   tol: '1',   key: 'anchoCintura' },
    { code: 'D', punto: 'Ancho de hombros',      htm: 'Punta a punta, plano',       tol: '1',   key: 'anchoHombro' },
    { code: 'E', punto: 'Ancho de cuello',       htm: 'Interior costura a costura', tol: '0.5', key: 'anchoCuello' },
    { code: 'F', punto: 'Profundidad de cuello', htm: 'Desde HPS a base del cuello', tol: '0.5', key: 'profundidadCuello' },
    { code: 'G', punto: 'Alto de sisa',          htm: 'Hombro a axila, recto',      tol: '0.5' },
    { code: 'H', punto: 'Ancho de collarete',    htm: 'Costura a borde',            tol: '0.3' },
    { code: 'I', punto: 'Alto de abertura',      htm: 'Ruedo a remate',             tol: '0.5' },
  ],
  short: [
    { code: 'A', punto: 'Largo total',      htm: 'Cintura a ruedo, costado', tol: '1',   key: 'largoTotal' },
    { code: 'B', punto: 'Cintura relajada', htm: 'Borde a borde, plano',     tol: '1',   key: 'cintura' },
    { code: 'C', punto: 'Cintura estirada', htm: 'Borde a borde, estirado',  tol: '1' },
    { code: 'D', punto: 'Cadera',           htm: '18 cm bajo cintura',       tol: '1',   key: 'cadera' },
    { code: 'E', punto: 'Tiro delantero',   htm: 'Entrepierna a cintura',    tol: '0.5' },
    { code: 'F', punto: 'Boca de pierna',   htm: 'Plano, una pierna',        tol: '0.5', key: 'ruedo' },
    { code: 'G', punto: 'Entrepierna',      htm: 'Costura interior',         tol: '0.5' },
    { code: 'H', punto: 'Alto de cintura',  htm: 'Borde a costura',          tol: '0.3' },
    { code: 'I', punto: 'Ancho de vivo',    htm: 'Plano',                    tol: '0.2' },
  ],
  pants: [
    { code: 'A', punto: 'Cintura',          htm: 'Borde a borde, plano',  tol: '1',   key: 'cintura' },
    { code: 'B', punto: 'Cadera / asiento', htm: '18 cm bajo cintura',    tol: '1',   key: 'cadera' },
    { code: 'C', punto: 'Tiro delantero',   htm: 'Entrepierna a cintura', tol: '0.5' },
    { code: 'D', punto: 'Tiro trasero',     htm: 'Entrepierna a cintura', tol: '0.5' },
    { code: 'E', punto: 'Muslo',            htm: '2.5 cm bajo entrepierna', tol: '0.5' },
    { code: 'F', punto: 'Rodilla',          htm: 'Plano',                 tol: '0.5', key: 'rodilla' },
    { code: 'G', punto: 'Boca de pierna',   htm: 'Plano',                 tol: '0.5', key: 'ruedo' },
    { code: 'H', punto: 'Entrepierna',      htm: 'Costura interior',      tol: '0.5' },
  ],
}

// ─── Graduación de talles ────────────────────────────────────────────────────
// Cuánto cambia cada medida de un talle al siguiente, en cm. Son los saltos
// típicos de punto (jersey, piqué) para medidas tomadas EN PLANO: el contorno
// de pecho crece 4 cm por talle, así que el ancho de pecho en plano crece 2.
// Son un punto de partida: cada marca tiene su tabla y se pisan en la ficha.
const GRADO_TIPICO: Record<string, number> = {
  'Largo total': 2, 'Ancho de pecho': 2, 'Ancho de cintura': 2, 'Ancho de hombros': 1.5,
  'Ancho de cuello': 0.5, 'Profundidad de cuello': 0.5, 'Largo de manga': 1, 'Ancho de manga': 0.6,
  'Alto de sisa': 1, 'Largo de tapeta': 0.5,
  'Cintura': 2, 'Cintura relajada': 2, 'Cintura estirada': 2, 'Cadera': 2, 'Cadera / asiento': 2,
  'Tiro delantero': 0.6, 'Tiro trasero': 0.8, 'Muslo': 1.2, 'Rodilla': 0.6, 'Boca de pierna': 0.5,
}
export const gradoTipico = (punto: string): number | null => GRADO_TIPICO[punto.trim()] ?? null

/** El salto de una fila: el que se cargó, o el típico si la ficha es de antes. */
export const gradoDe = (r: PomRow): number | null => r.grado === undefined ? gradoTipico(r.punto) : r.grado

const ESCALA = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']

/**
 * Los talles de un rango como lo escribe la gente: "S–XL", "S-XL", "s a xl",
 * o numérico ("38–46", de 2 en 2, como el pantalón). Null si no se entiende
 * o si el talle base no está adentro: mejor no graduar que graduar mal.
 */
export function tallesDelRango(rango: string, base: string): string[] | null {
  const partes = rango.trim().toUpperCase().split(/\s*(?:[–—-]|\bA\b)\s*/).filter(Boolean)
  if (partes.length !== 2) return null
  const b = base.trim().toUpperCase()
  const [desde, hasta] = partes
  if (/^\d+$/.test(desde) && /^\d+$/.test(hasta)) {
    const lista: string[] = []
    for (let n = +desde; n <= +hasta && lista.length < 12; n += 2) lista.push(String(n))
    return lista.includes(b) ? lista : null
  }
  const i = ESCALA.indexOf(desde), j = ESCALA.indexOf(hasta)
  if (i < 0 || j < i) return null
  const lista = ESCALA.slice(i, j + 1)
  return lista.includes(b) ? lista : null
}

function defaultPoms(mockupId: Project['mockupId'], measures: Record<string, number> | null): PomRow[] {
  // Estas tres no comparten la tabla de la remera: no tienen manga, o
  // directamente no son una prenda de arriba.
  if (mockupId === 'pants' || mockupId === 'musculosa' || mockupId === 'short') {
    return EXTRA_POMS[mockupId].map(p => ({
      id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol,
      base: (measures && p.key && measures[p.key] != null) ? measures[p.key] : null,
    }))
  }
  const rows: PomRow[] = BASE_POMS.map(p => ({
    id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol,
    base: measures ? measures[p.key] : null,
  }))
  if (mockupId === 'chomba') {
    rows.push(...EXTRA_POMS.chomba.map(p => ({ id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol, base: null })))
  }
  return rows
}

// ─── Slots de imagen (uno por rol; se separan las anotaciones por página) ─────
function defaultImages(snapshot: string | null): TechPackImageSlot[] {
  return [
    { id: uid(), role: 'front',    label: 'Frente',                src: snapshot, auto: true },
    { id: uid(), role: 'back',     label: 'Espalda',               src: null },
    { id: uid(), role: 'specs',    label: 'Frente (especificaciones)', src: snapshot, auto: true },
    { id: uid(), role: 'measures', label: 'Frente (medidas)',      src: snapshot, auto: true },
  ]
}

/**
 * Pone al día los dibujos que salieron del lienzo.
 *
 * La ficha se guarda con el diseño adentro, así que al seguir diseñando la
 * ficha se quedaba mostrando la prenda vieja: cambiabas el color, el número o
 * un logo, abrías la ficha y seguía la de antes. La única salida era exportar
 * un PNG y volver a cargarlo a mano, justo el trabajo que la ficha existe para
 * ahorrar.
 *
 * Solo se tocan los dibujos que puso la app. Una foto que subió el diseñador
 * se queda como está.
 */
export function refrescarImagenesAuto(doc: TechPackDoc, snapshot: string | null): TechPackDoc {
  if (!snapshot) return doc
  // Las tres ranuras que la app llena sola. "Espalda" no esta: nace vacia, asi
  // que lo que haya ahi lo puso una persona.
  const DEL_LIENZO: ImageRole[] = ['front', 'specs', 'measures']
  let cambio = false
  const images = doc.images.map(s => {
    // `auto` no existia en las fichas viejas: ahi manda el rol. Solo un
    // `auto: false` explicito —puesto al elegir una foto a mano— bloquea.
    const laPusoLaApp = s.auto !== false && DEL_LIENZO.includes(s.role)
    if (!laPusoLaApp || s.src === snapshot) return s
    cambio = true
    return { ...s, src: snapshot, auto: true }
  })
  return cambio ? { ...doc, images } : doc
}

/**
 * Las fichas hechas antes de que existiera la página de estampados no la
 * tienen. Si el diseño tiene estampados, se agrega después de "Diseño": es la
 * información que más le falta al taller, y quien la necesita no va a ir a
 * buscarla a "Agregar página".
 */
export function conPaginaEstampados(doc: TechPackDoc, hayEstampados: boolean, mockupId: Project['mockupId']): TechPackDoc {
  if (!hayEstampados || doc.pages.some(p => p.kind === 'prints')) return doc
  const i = doc.pages.findIndex(p => p.kind === 'design')
  const pages = [...doc.pages]
  pages.splice(i + 1, 0, makePage('prints', mockupId))
  return { ...doc, pages }
}

export function buildDefaultTechPack(
  project: Project,
  measures: Record<string, number> | null,
  snapshot: string | null,
): TechPackDoc {
  const pages: TechPackPage[] = DEFAULT_PAGES.map(kind => ({
    id: uid(), kind, title: titleOf(kind), body: defaultBody(kind, project.mockupId),
  }))

  return {
    version: 2,
    pages,
    bom: defaultBom(project.mockupId, project.colors ?? []),
    poms: defaultPoms(project.mockupId, measures),
    images: defaultImages(snapshot),
    annotations: [],
    notes: 'Observaciones generales para el taller.',
    meta: {
      fabricaProveedor: '',
      telaPrincipal: 'Jersey algodón 180 GSM',
      talleBase: 'M',
      rangoTalles: 'S–XL',
    },
  }
}

export function makePage(kind: TechPackPageKind, mockupId: Project['mockupId']): TechPackPage {
  return { id: uid(), kind, title: titleOf(kind), body: defaultBody(kind, mockupId) }
}

// Parsea el doc guardado; si falta o es de un formato viejo (sin pages), null
// para que el caller reconstruya el default.
export function parseTechPack(json: string | null): TechPackDoc | null {
  if (!json) return null
  try {
    const doc = JSON.parse(json) as TechPackDoc
    if (!doc || !Array.isArray(doc.pages) || !Array.isArray(doc.images)) return null
    return doc
  } catch {
    return null
  }
}
