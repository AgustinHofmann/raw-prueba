import type {
  Project, TechPackDoc, TechPackPage, TechPackPageKind,
  TechPackMeasures, BomRow, PomRow, TechPackImageSlot,
} from '../types/project'

const uid = () => crypto.randomUUID()

// Catálogo de páginas disponibles (título por defecto)
export const PAGE_CATALOG: { kind: TechPackPageKind; title: string }[] = [
  { kind: 'design',    title: 'Diseño' },
  { kind: 'specs',     title: 'Especificaciones' },
  { kind: 'measures',  title: 'Tabla de medidas' },
  { kind: 'materials', title: 'Materiales' },
  { kind: 'colorways', title: 'Colorways' },
  { kind: 'notes',     title: 'Notas' },
]

// Páginas por defecto de una ficha nueva (orden típico de fábrica)
const DEFAULT_PAGES: TechPackPageKind[] = ['design', 'specs', 'measures', 'materials']

export const garmentName = (mockupId: Project['mockupId']) =>
  mockupId === 'tshirt' ? 'Remera' : mockupId === 'hoodie' ? 'Buzo' : 'Pantalón'

const titleOf = (kind: TechPackPageKind) => PAGE_CATALOG.find(p => p.kind === kind)?.title ?? kind

function defaultBody(kind: TechPackPageKind, mockupId: Project['mockupId']): string {
  if (kind === 'specs') {
    return mockupId === 'pants'
      ? 'Construcción: doble pespunte en tiro y entrepierna · Cintura con elástico/pretina · Ruedo dobladillo 2 cm · Bolsillos según diseño.'
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
  if (mockupId === 'hoodie') {
    base.push(
      { categoria: 'Tela', descripcion: 'Rib puño/cintura',       placement: 'Puños y cintura', composicion: '95% algodón / 5% elastano', color: dtm, proveedor: '', consumo: '', uom: 'm', notas: '' },
      { categoria: 'Trim', descripcion: 'Cordón capucha + tanca', placement: 'Capucha', composicion: '', color: '', proveedor: '', consumo: '1', uom: 'u', notas: '' },
      { categoria: 'Tela', descripcion: 'Frisa interior',         placement: 'Cuerpo', composicion: '100% algodón', color: dtm, proveedor: '', consumo: '', uom: 'm', notas: '' },
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
const BASE_POMS: { code: string; punto: string; key: keyof TechPackMeasures; htm: string; tol: string }[] = [
  { code: 'A', punto: 'Largo total',           key: 'largoTotal',        htm: 'Desde HPS hasta ruedo',       tol: '1' },
  { code: 'B', punto: 'Ancho de pecho',        key: 'anchoPecho',        htm: '2.5 cm bajo sisa, plano',     tol: '1' },
  { code: 'C', punto: 'Ancho de cintura',      key: 'anchoCintura',      htm: 'Punto más angosto, plano',    tol: '1' },
  { code: 'D', punto: 'Ancho de cuello',       key: 'anchoCuello',       htm: 'Interior costura a costura',  tol: '0.5' },
  { code: 'E', punto: 'Profundidad de cuello', key: 'profundidadCuello', htm: 'Desde HPS a base del cuello', tol: '0.5' },
  { code: 'F', punto: 'Largo de manga',        key: 'largoManga',        htm: 'Desde hombro a boca de manga', tol: '0.5' },
  { code: 'G', punto: 'Ancho de manga',        key: 'anchoManga',        htm: 'Plano en la sisa',            tol: '0.5' },
]

const EXTRA_POMS: Record<Project['mockupId'], { code: string; punto: string; htm: string; tol: string }[]> = {
  tshirt: [],
  hoodie: [
    { code: 'H', punto: 'Alto de capucha',  htm: 'Base a punta',    tol: '1' },
    { code: 'I', punto: 'Ancho de capucha', htm: 'Plano, mitad',    tol: '1' },
    { code: 'J', punto: 'Bolsillo canguro', htm: 'Ancho total',     tol: '1' },
    { code: 'K', punto: 'Alto rib cintura', htm: 'Borde a costura', tol: '0.5' },
  ],
  pants: [
    { code: 'A', punto: 'Cintura',          htm: 'Borde a borde, plano',  tol: '1' },
    { code: 'B', punto: 'Cadera / asiento', htm: '18 cm bajo cintura',    tol: '1' },
    { code: 'C', punto: 'Tiro delantero',   htm: 'Entrepierna a cintura', tol: '0.5' },
    { code: 'D', punto: 'Tiro trasero',     htm: 'Entrepierna a cintura', tol: '0.5' },
    { code: 'E', punto: 'Muslo',            htm: '2.5 cm bajo entrepierna', tol: '0.5' },
    { code: 'F', punto: 'Rodilla',          htm: 'Plano',                 tol: '0.5' },
    { code: 'G', punto: 'Boca de pierna',   htm: 'Plano',                 tol: '0.5' },
    { code: 'H', punto: 'Entrepierna',      htm: 'Costura interior',      tol: '0.5' },
  ],
}

function defaultPoms(mockupId: Project['mockupId'], measures: TechPackMeasures | null): PomRow[] {
  if (mockupId === 'pants') {
    return EXTRA_POMS.pants.map(p => ({ id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol, base: null }))
  }
  const rows: PomRow[] = BASE_POMS.map(p => ({
    id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol,
    base: measures ? measures[p.key] : null,
  }))
  if (mockupId === 'hoodie') {
    rows.push(...EXTRA_POMS.hoodie.map(p => ({ id: uid(), code: p.code, punto: p.punto, comoMedir: p.htm, tolerancia: p.tol, base: null })))
  }
  return rows
}

// ─── Slots de imagen (uno por rol; se separan las anotaciones por página) ─────
function defaultImages(snapshot: string | null): TechPackImageSlot[] {
  return [
    { id: uid(), role: 'front',    label: 'Frente',                src: snapshot },
    { id: uid(), role: 'back',     label: 'Espalda',               src: null },
    { id: uid(), role: 'specs',    label: 'Frente (especificaciones)', src: snapshot },
    { id: uid(), role: 'measures', label: 'Frente (medidas)',      src: snapshot },
  ]
}

export function buildDefaultTechPack(
  project: Project,
  measures: TechPackMeasures | null,
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
