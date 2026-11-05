import type { Project } from '../types/project'

/**
 * Diseños para arrancar: la prenda de un color y textos ubicados como los pide
 * el taller (en cm, desde la línea del centro y desde el hombro).
 *
 * Son recetas y no archivos guardados a propósito: un diseño guardado trae
 * coordenadas del lienzo, que dependen del tamaño de la ventana donde se hizo.
 * La receta se arma sobre la prenda ya dibujada, así cae en el mismo lugar de
 * la prenda en cualquier pantalla.
 */
export interface Plantilla {
  id: string
  nombre: string
  descripcion: string
  mockupId: Project['mockupId']
  /** Tela lisa de toda la prenda. */
  color: string
  textos: {
    texto: string
    /** De GOOGLE_FONTS o SYSTEM_FONTS: tiene que verse igual en cualquier compu. */
    fuente: string
    color: string
    /** Ancho del texto, en cm. */
    ancho: number
    /** Cm desde la línea del centro; negativo, a la izquierda mirando el dibujo. */
    centro: number
    /** Cm desde el punto alto del hombro (HPS) o la cintura al borde de arriba. */
    arriba: number
  }[]
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'remera-marca', nombre: 'Remera de marca', mockupId: 'tshirt', color: '#1d1d1b',
    descripcion: 'Negra, con el nombre de la marca en el pecho',
    textos: [
      { texto: 'TU MARCA', fuente: 'Bebas Neue', color: '#f4f4f1', ancho: 24, centro: 0, arriba: 14 },
      { texto: 'EST. 2026', fuente: 'Montserrat', color: '#a3a3a1', ancho: 8, centro: 0, arriba: 22 },
    ],
  },
  {
    id: 'remera-club', nombre: 'Remera de club', mockupId: 'tshirt', color: '#f4f4f1',
    descripcion: 'Blanca, con el nombre del club y el número',
    textos: [
      { texto: 'CLUB ATLÉTICO', fuente: 'Anton', color: '#1f2a44', ancho: 26, centro: 0, arriba: 13 },
      { texto: '10', fuente: 'Anton', color: '#b3262e', ancho: 12, centro: 0, arriba: 19 },
    ],
  },
  {
    id: 'chomba-logo', nombre: 'Chomba con logo', mockupId: 'chomba', color: '#1f2a44',
    descripcion: 'Azul marino, con el logo chico en el pecho izquierdo',
    // El pecho izquierdo de quien la usa queda a la DERECHA mirando el dibujo.
    textos: [
      { texto: 'RAW', fuente: 'Playfair Display', color: '#e9e2d0', ancho: 7, centro: 10, arriba: 18 },
    ],
  },
  {
    id: 'musculosa-running', nombre: 'Musculosa de running', mockupId: 'musculosa', color: '#b3262e',
    descripcion: 'Roja, con el nombre del grupo en el pecho',
    textos: [
      { texto: 'RUN CLUB', fuente: 'Bebas Neue', color: '#f4f4f1', ancho: 24, centro: 0, arriba: 16 },
      { texto: 'BUENOS AIRES', fuente: 'Montserrat', color: '#f4f4f1', ancho: 14, centro: 0, arriba: 24 },
    ],
  },
]

export const plantillaPorId = (id?: string | null) => PLANTILLAS.find(p => p.id === id) ?? null
