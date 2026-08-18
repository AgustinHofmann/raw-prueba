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
// Tolera que la columna no exista todavía (migración pendiente) → devuelve null.
export async function fetchProjectTechpack(id: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('techpack_json')
      .eq('id', id)
      .single()
    if (error) throw error
    return ((data as Record<string, unknown>)?.techpack_json as string | null) ?? null
  } catch {
    return null
  }
}

export async function upsertProject(p: Project, userId?: string): Promise<void> {
  const { error } = await supabase.from('projects').upsert({
    ...projectToRow(p),
    ...(userId ? { user_id: userId } : {}),
  })
  if (error) throw error
}

// Guarda solo techpack_json. Falla silenciosamente si la columna no existe aún.
export async function saveTechpackJson(id: string, json: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ techpack_json: json, updated_at: Date.now() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
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

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('folders').delete().eq('id', id)
  if (error) throw error
}

// ─── Profile (nickname) ──────────────────────────────────────────────────────

// Mismas reglas que el CHECK de la base (supabase/security.sql). Validar en el
// cliente da un error amable al instante; la base sigue siendo la autoridad.
export const NICKNAME_RE = /^[A-Za-z0-9_]{3,24}$/

export async function fetchMyNickname(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as { nickname: string } | null)?.nickname ?? null
}

export async function saveNickname(userId: string, nickname: string): Promise<void> {
  if (!NICKNAME_RE.test(nickname)) {
    throw new Error('El nickname debe tener 3–24 caracteres: letras, números o _')
  }
  const { error } = await supabase.from('profiles').upsert({ id: userId, nickname })
  if (error) {
    // 23505 = unique_violation (índice único sobre lower(nickname))
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Ese nickname ya está en uso')
    }
    throw error
  }
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
