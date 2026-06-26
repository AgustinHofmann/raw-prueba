export interface Project {
  id: string
  name: string
  mockupId: 'tshirt' | 'hoodie' | 'pants'
  thumbnail: string | null
  canvasJson: string | null
  techpackJson: string | null   // documento de ficha técnica serializado (TechPackDoc como JSON)
  colors: string[]
  tag: string
  folderId: string | null
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  createdAt: number
}

// Medidas paramétricas que se muestran en la ficha técnica (Tech Pack)
export interface TechPackMeasures {
  largoTotal: number; anchoPecho: number; anchoCintura: number
  anchoCuello: number; profundidadCuello: number; largoManga: number; anchoManga: number
}

// Una pestaña interna de la app. Un proyecto puede tener hasta dos:
// su editor y su ficha técnica (Tech Pack), abiertos en paralelo.
export type Tab =
  | { kind: 'editor';   project: Project }
  | { kind: 'techpack'; project: Project; snapshot: string; measures: TechPackMeasures | null }

// Identidad única de una pestaña: kind + id de proyecto (no solo el id,
// porque un mismo proyecto puede estar abierto como editor y como techpack).
export const tabKey = (t: Tab) => `${t.kind}:${t.project.id}`

// ─── Modelo del documento de ficha técnica (Tech Pack) ───────────────────────

// Un tech pack profesional es un documento APAISADO MULTIPÁGINA pensado para
// fábrica: cada página tiene un propósito (diseño, especificaciones, medidas…).
export type TechPackPageKind = 'design' | 'specs' | 'measures' | 'materials' | 'colorways' | 'notes'

// Una página del documento. body = notas/observaciones libres de esa página.
export interface TechPackPage {
  id: string
  kind: TechPackPageKind
  title: string
  body: string
}

// Fila de la lista de materiales (BOM)
export interface BomRow {
  id: string
  categoria: string   // Tela / Trim / Hilo / Etiqueta / Packaging
  descripcion: string
  placement: string
  composicion: string
  color: string       // hex (#…) o nombre
  proveedor: string
  consumo: string
  uom: string         // u / cm / m
  notas: string
}

// Fila de punto de medida (POM)
export interface PomRow {
  id: string
  code: string        // A, B, C…
  punto: string       // Largo total, Ancho de pecho…
  comoMedir: string
  tolerancia: string  // ± cm
  base: number | null // valor del talle base (M)
}

export type AnnotationKind = 'arrow' | 'leader' | 'callout' | 'bubble'
export type AnnotationCategory = 'construccion' | 'material' | 'medida'

// Anotación visual anclada a una imagen. La punta (tip) y la caja (box) viven
// en coordenadas normalizadas (0..1) de la imagen para sobrevivir a reemplazos.
export interface Annotation {
  id: string
  slotId: string      // id del slot de imagen al que está anclada
  kind: AnnotationKind
  category: AnnotationCategory
  tipX: number; tipY: number
  boxX: number; boxY: number
  text: string
  number?: number     // para callouts numerados
  dashed?: boolean    // leader: punteado (pespunte) vs sólido (costura)
}

// Rol de cada imagen del documento: cada página usa el slot de su propósito,
// así las anotaciones quedan separadas por página (cada slot tiene su id).
export type ImageRole = 'front' | 'back' | 'specs' | 'measures' | 'detail'

export interface TechPackImageSlot {
  id: string
  role: ImageRole
  label: string
  src: string | null  // data URL
}

// Metadatos mínimos y relevantes para fábrica (sin drop/temporada/etc.)
export interface TechPackMeta {
  fabricaProveedor: string  // a quién va dirigida la ficha
  telaPrincipal: string     // tela principal + composición/gramaje
  talleBase: string         // talle base (M)
  rangoTalles: string       // S–XL
}

// Documento completo de ficha técnica que se serializa en project.techpackJson
export interface TechPackDoc {
  version: number
  pages: TechPackPage[]
  bom: BomRow[]
  poms: PomRow[]
  images: TechPackImageSlot[]
  annotations: Annotation[]
  notes: string
  meta: TechPackMeta
}
