import { supabase } from './supabase'
import type { Project, Folder } from '../types/project'

// ─── Projects ────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToProject)
}

export async function upsertProject(p: Project): Promise<void> {
  const { error } = await supabase.from('projects').upsert(projectToRow(p))
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

export async function upsertFolder(f: Folder): Promise<void> {
  const { error } = await supabase.from('folders').upsert(folderToRow(f))
  if (error) throw error
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('folders').delete().eq('id', id)
  if (error) throw error
}

// ─── Mappers (camelCase ↔ snake_case) ────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id:         row.id         as string,
    name:       row.name       as string,
    mockupId:   row.mockup_id  as Project['mockupId'],
    thumbnail:  row.thumbnail  as string | null,
    canvasJson: row.canvas_json as string | null,
    colors:     (row.colors    as string[]) ?? [],
    tag:        (row.tag       as string)   ?? '',
    folderId:   row.folder_id  as string | null,
    createdAt:  row.created_at as number,
    updatedAt:  row.updated_at as number,
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
    id:        row.id        as string,
    name:      row.name      as string,
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
