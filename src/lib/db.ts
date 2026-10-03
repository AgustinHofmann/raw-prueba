import { supabase } from './supabase'
import type { Project, Folder } from '../types/project'

// ─── Projects ────────────────────────────────────────────────────────────────

// Lista ligera — sin canvas_json para no descargar datos pesados innecesariamente
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,name,mockup_id,thumbnail,colors,tag,folder_id,user_id,created_at,updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(row => ({ ...rowToProject(row), canvasJson: null }))
}

// Carga el canvas_json solo cuando el usuario abre el proyecto
export async function fetchProjectCanvas(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('canvas_json')
    .eq('id', id)
    .single()
  if (error) throw error
  return (data as Record<string, unknown>)?.canvas_json as string | null
}

// Carga el techpack_json (ficha técnica) de forma lazy al abrir la pestaña.
export async function fetchProjectTechpack(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('techpack_json')
    .eq('id', id)
    .single()
  if (error) throw error
  return ((data as Record<string, unknown>)?.techpack_json as string | null) ?? null
}

/**
 * Sube un proyecto y devuelve la fecha que le puso EL SERVIDOR.
 *
 * Esa fecha es la única referencia común entre dos dispositivos: la base tiene
 * un disparador que reescribe `updated_at` con su propio reloj (migración 0005),
 * así que la fecha del navegador no sirve para comparar. Guardándola se puede
 * saber después si la copia de la nube cambió desde la última vez que este
 * dispositivo la vio, que es lo que hace falta para no pisar el trabajo de otro.
 */
export async function upsertProject(p: Project, userId?: string): Promise<number | null> {
  const { data, error } = await supabase.from('projects').upsert({
    ...projectToRow(p),
    ...(userId ? { user_id: userId } : {}),
  }).select('updated_at')
  if (error) throw error
  const fila = data?.[0] as { updated_at?: number } | undefined
  return fila?.updated_at ?? null
}

// Guarda solo el techpack_json, sin tocar el resto del proyecto.
export async function saveTechpackJson(id: string, json: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ techpack_json: json, updated_at: Date.now() })
    .eq('id', id)
  if (error) throw error
}

// Borrar de verdad, no "pedir por favor".
//
// `delete()` a secas devuelve OK aunque no haya borrado NADA: si la regla de
// seguridad de la fila no coincide (por ejemplo la fila quedó sin dueño), la
// base descarta el borrado sin avisar. El proyecto seguía arriba y al recargar
// la sincronización lo volvía a bajar: lo borrabas y reaparecía.
//
// Con `.select()` la base devuelve las filas que realmente borró. Si no volvió
// ninguna, esto FALLA a propósito, para que el borrado quede anotado como
// pendiente y se reintente en vez de darse por hecho.
export async function deleteProject(id: string): Promise<void> {
  const { data, error } = await supabase.from('projects').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`La base no borró el proyecto ${id}`)
}

// ─── Folders ─────────────────────────────────────────────────────────────────

export async function fetchFolders(): Promise<Folder[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToFolder)
}

export async function upsertFolder(f: Folder, userId?: string): Promise<void> {
  const { error } = await supabase.from('folders').upsert({
    ...folderToRow(f),
    ...(userId ? { user_id: userId } : {}),
  })
  if (error) throw error
}

// Mismo criterio que deleteProject: si no volvió ninguna fila, no se borró.
export async function deleteFolder(id: string): Promise<void> {
  const { data, error } = await supabase.from('folders').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`La base no borró la carpeta ${id}`)
}

// ─── Mappers (camelCase ↔ snake_case) ────────────────────────────────────────

// El buzo salió del catálogo, pero puede haber proyectos guardados con
// mockup_id = 'hoodie'. Sin esto la app buscaría /mockups/hoodie.svg, no lo
// encontraría y el proyecto abriría vacío. Se abre como remera, que es la
// prenda por defecto, en vez de romperse.
const MOCKUPS_VALIDOS: Project['mockupId'][] = ['tshirt', 'chomba', 'pants']
function normalizeMockupId(v: unknown): Project['mockupId'] {
  return MOCKUPS_VALIDOS.includes(v as Project['mockupId']) ? v as Project['mockupId'] : 'tshirt'
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id:         row.id          as string,
    name:       row.name        as string,
    mockupId:   normalizeMockupId(row.mockup_id),
    thumbnail:  row.thumbnail   as string | null,
    canvasJson: row.canvas_json as string | null,
    techpackJson: ((row.techpack_json as string | null) ?? null),
    colors:     (row.colors     as string[]) ?? [],
    tag:        (row.tag        as string)   ?? '',
    folderId:   row.folder_id   as string | null,
    createdAt:  row.created_at  as number,
    updatedAt:  row.updated_at  as number,
  }
}

function projectToRow(p: Project) {
  return {
    id:          p.id,
    name:        p.name,
    mockup_id:   p.mockupId,
    thumbnail:   p.thumbnail,
    canvas_json: p.canvasJson,
    colors:      p.colors,
    tag:         p.tag,
    folder_id:   p.folderId,
    created_at:  p.createdAt,
    updated_at:  p.updatedAt,
  }
}

function rowToFolder(row: Record<string, unknown>): Folder {
  return {
    id:        row.id         as string,
    name:      row.name       as string,
    createdAt: row.created_at as number,
  }
}

function folderToRow(f: Folder) {
  return {
    id:         f.id,
    name:       f.name,
    created_at: f.createdAt,
  }
}
