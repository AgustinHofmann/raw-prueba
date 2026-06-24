export interface Project {
  id: string
  name: string
  mockupId: 'tshirt' | 'hoodie' | 'pants'
  thumbnail: string | null
  canvasJson: string | null
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
