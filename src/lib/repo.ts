// De dónde salen y a dónde van los proyectos.
//
// REGLA: el navegador manda. Todo se lee y se escribe primero en la base local
// (IndexedDB) y recién después, si hay nube y hay internet, se manda arriba.
//
// Por qué así y no al revés:
// - Guardar deja de depender de la red. Antes, sin internet, guardar fallaba y
//   el trabajo se perdía.
// - La app abre al instante: los proyectos ya están en la máquina.
// - Sin credenciales de Supabase el programa sigue siendo un programa, en vez de
//   una pantalla negra.
//
// Lo que se pierde sin nube es lo que corresponde perder: la cuenta, y ver los
// proyectos desde otra computadora.

import { supabase, cloudEnabled } from './supabase'
import {
  STORE_PROJECTS, STORE_FOLDERS, STORE_DELETED,
  idbGetAll, idbGet, idbPut, idbDelete,
} from './idb'
import {
  fetchProjects, fetchProjectCanvas, fetchProjectTechpack, upsertProject, deleteProject,
  fetchFolders, upsertFolder, deleteFolder,
} from './db'
import type { Project, Folder } from '../types/project'

/** Un borrado hecho sin conexión, esperando a poder aplicarse en la nube. */
interface Tombstone { id: string; kind: 'project' | 'folder'; at: number }

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/** ¿Se puede hablar con la nube AHORA? Hace falta credenciales, red y sesión. */
export async function cloudReady(): Promise<boolean> {
  if (!cloudEnabled || !isOnline()) return false
  try {
    const { data } = await supabase.auth.getSession()
    return Boolean(data.session)
  } catch { return false }
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const all = await idbGetAll<Project>(STORE_PROJECTS)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const listFolders = () => idbGetAll<Folder>(STORE_FOLDERS)

/**
 * El dibujo de un proyecto. Sale de local; si el proyecto vino de la nube y
 * todavía no se bajó su dibujo, se baja ahora y queda guardado para la próxima
 * (que puede ser sin internet).
 */
export async function getCanvas(id: string): Promise<string | null> {
  const local = await idbGet<Project>(STORE_PROJECTS, id)
  if (local?.canvasJson != null) return local.canvasJson
  if (!(await cloudReady())) return null
  try {
    const json = await fetchProjectCanvas(id)
    if (local && json != null) await idbPut(STORE_PROJECTS, { ...local, canvasJson: json })
    return json
  } catch { return null }
}

export async function getTechpack(id: string): Promise<string | null> {
  const local = await idbGet<Project>(STORE_PROJECTS, id)
  if (local?.techpackJson != null) return local.techpackJson
  if (!(await cloudReady())) return null
  try {
    const json = await fetchProjectTechpack(id)
    if (local && json != null) await idbPut(STORE_PROJECTS, { ...local, techpackJson: json })
    return json
  } catch { return null }
}

// ─── Escritura ───────────────────────────────────────────────────────────────

/**
 * Guarda un proyecto. Devuelve true si quedó guardado EN ALGÚN LADO.
 *
 * Local es lo que decide el resultado: si se guardó en la máquina, el trabajo
 * está a salvo y la respuesta es true aunque la nube haya fallado. Decirle al
 * diseñador que falló porque no hay internet sería mentirle al revés.
 */
/**
 * Marca de "esto todavía no llegó a la nube".
 *
 * Hace falta porque las fechas de los dos lados NO son comparables: la base
 * tiene un disparador que reescribe updated_at con el reloj del servidor
 * (migración 0005), mientras que la fecha local la pone el navegador. Si el
 * reloj del servidor va adelante, la copia de la nube parece más nueva aunque
 * tenga contenido viejo, y la sincronización la bajaba encima del trabajo
 * recién hecho: guardabas, recargabas, y tu cambio no estaba.
 *
 * Con esta marca la regla deja de depender de relojes: si acá hay algo sin
 * subir, acá está lo bueno.
 */
type Pendiente = Project & { pendienteDeSubir?: boolean }

/**
 * `revivir` es para cuando el usuario trae de vuelta a propósito un proyecto con
 * un id ya borrado (importar el archivo otra vez). Sin eso, guardar NO resucita:
 * un proyecto borrado se queda borrado.
 *
 * Hace falta porque el editor autoguarda con retraso. Si borrabas el proyecto
 * que tenías abierto, el autoguardado saltaba un segundo después y lo volvía a
 * escribir en la base local — borrado y de vuelta en pantalla al recargar.
 */
export async function saveProject(
  p: Project, userId?: string, opts?: { revivir?: boolean },
): Promise<boolean> {
  if (opts?.revivir) await idbDelete(STORE_DELETED, p.id)
  else if (await idbGet<Tombstone>(STORE_DELETED, p.id)) return false   // ya estaba borrado
  const conMarca: Pendiente = { ...p, pendienteDeSubir: true }
  const ok = (await idbPut(STORE_PROJECTS, conMarca)) !== null
  void pushProject(p, userId)
  return ok
}

async function pushProject(p: Project, userId?: string): Promise<void> {
  if (!(await cloudReady())) return
  try {
    await upsertProject(p, userId)
    // Subió: se limpia la marca, pero solo si nadie volvió a guardar mientras
    // tanto (si la fecha cambió, hay cambios más nuevos todavía sin subir).
    const actual = await idbGet<Pendiente>(STORE_PROJECTS, p.id)
    if (actual && actual.updatedAt === p.updatedAt && actual.pendienteDeSubir) {
      await idbPut(STORE_PROJECTS, { ...actual, pendienteDeSubir: false })
    }
  } catch { /* queda marcado como pendiente para el próximo sync */ }
}

export async function saveTechpack(id: string, json: string, userId?: string): Promise<boolean> {
  const local = await idbGet<Project>(STORE_PROJECTS, id)
  // Sin registro local no se inventa uno: guardar {id, techpackJson} pelado
  // creaba un proyecto sin dibujo y con fecha nueva, así que al sincronizar le
  // ganaba al de verdad y se llevaba puesto el diseño.
  if (!local) return false
  const updated: Project = { ...local, techpackJson: json, updatedAt: Date.now() }
  const ok = (await idbPut(STORE_PROJECTS, updated)) !== null
  void pushProject(updated, userId)
  return ok
}

export async function saveFolder(f: Folder, userId?: string): Promise<void> {
  await idbPut(STORE_FOLDERS, f)
  await idbDelete(STORE_DELETED, f.id)   // crear/renombrar una carpeta sí la revive
  if (await cloudReady()) { try { await upsertFolder(f, userId) } catch { /* pendiente */ } }
}

export async function removeProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id)
  await applyRemoteDelete(id, 'project')
}

export async function removeFolder(id: string): Promise<void> {
  await idbDelete(STORE_FOLDERS, id)
  await applyRemoteDelete(id, 'folder')
}

// Un borrado no se puede perder: si solo se borrara local, el próximo sync lo
// bajaría de vuelta de la nube y reaparecería como un fantasma.
//
// El anotado va SIEMPRE y va PRIMERO, no solo cuando no hay internet. Antes se
// anotaba únicamente si el borrado de la nube tiraba error, y el caso que rompía
// era justo el que no tira error: la base contesta OK habiendo borrado cero
// filas. Como nadie anotaba nada, el proyecto seguía arriba y volvía al recargar.
//
// La anotación se levanta recién cuando la nube CONFIRMA el borrado.
async function applyRemoteDelete(id: string, kind: 'project' | 'folder'): Promise<void> {
  await idbPut<Tombstone>(STORE_DELETED, { id, kind, at: Date.now() })
  if (!(await cloudReady())) return
  try {
    if (kind === 'project') await deleteProject(id)
    else await deleteFolder(id)
    await idbDelete(STORE_DELETED, id)
  } catch { /* queda anotado y se reintenta en el próximo sync */ }
}

// ─── Sincronización ──────────────────────────────────────────────────────────

/**
 * Pone de acuerdo lo local con la nube y devuelve el resultado.
 *
 * Gana el más nuevo por `updatedAt`, en los dos sentidos. Es la regla más simple
 * que no pierde trabajo: si tocaste el proyecto sin internet, tu versión sube;
 * si lo tocaste en otra computadora, baja la de allá.
 *
 * Lo que NO hace: fusionar dos ediciones del mismo proyecto hechas a la vez en
 * dos máquinas. En ese caso gana la última y la otra se pierde. Fusionar de
 * verdad dos lienzos es otro problema y merece pensarse aparte.
 */
export async function syncWithCloud(userId?: string): Promise<{ projects: Project[]; folders: Folder[] } | null> {
  if (!(await cloudReady())) return null

  try {
    // 1. Primero los borrados pendientes, antes de bajar nada: si no, lo que
    //    borraste sin internet volvería a aparecer en este mismo sync.
    const pendientes = await idbGetAll<Tombstone>(STORE_DELETED)
    for (const t of pendientes) {
      try {
        if (t.kind === 'project') await deleteProject(t.id)
        else await deleteFolder(t.id)
        await idbDelete(STORE_DELETED, t.id)
      } catch { /* se reintenta el próximo sync */ }
    }
    // Lo borrado acá NO vuelve, aunque la nube se haya negado a borrarlo. Sin
    // esta lista, una fila que la base no deja borrar (por ejemplo porque quedó
    // sin dueño) reaparecía en CADA arranque: el usuario la borraba una y otra
    // vez y siempre volvía. Mientras la anotación siga puesta, se la ignora.
    const borrados = new Set(
      (await idbGetAll<Tombstone>(STORE_DELETED)).map(t => t.id),
    )

    // 2. Carpetas: son livianas, se resuelven de una.
    const [nubeCarpetas, localesCarpetas] = await Promise.all([fetchFolders(), listFolders()])
    const carpetas = new Map<string, Folder>()
    for (const f of nubeCarpetas) { if (!borrados.has(f.id)) carpetas.set(f.id, f) }
    for (const f of localesCarpetas) {
      if (!carpetas.has(f.id)) { carpetas.set(f.id, f); try { await upsertFolder(f, userId) } catch { /* luego */ } }
    }
    for (const f of carpetas.values()) await idbPut(STORE_FOLDERS, f)

    // 3. Proyectos. La lista de la nube viene sin el dibujo (es pesado), así que
    //    de los que ganan arriba hay que bajar el contenido aparte.
    const [nube, locales] = await Promise.all([fetchProjects(), listProjects()])
    const porId = new Map<string, Project>()
    for (const p of locales) porId.set(p.id, p)

    for (const remoto of nube) {
      if (borrados.has(remoto.id)) continue   // borrado acá: no vuelve
      const local = porId.get(remoto.id) as Pendiente | undefined
      // Lo que todavía no subió manda siempre, sin mirar fechas: son cambios que
      // solo existen acá. Compararlos contra el reloj del servidor los perdía.
      if (local?.pendienteDeSubir) continue
      if (local && local.updatedAt >= remoto.updatedAt) continue   // manda el local
      const [canvasJson, techpackJson] = await Promise.all([
        fetchProjectCanvas(remoto.id).catch(() => null),
        fetchProjectTechpack(remoto.id).catch(() => null),
      ])
      // Si la nube no trae dibujo (falló la descarga, o esa fila nunca llegó a
      // guardarlo) se conserva el que hay acá. Pisar un diseño con vacío porque
      // la fila de arriba está más nueva es perder trabajo, y encima en silencio.
      const completo: Project = {
        ...remoto,
        canvasJson:   canvasJson   ?? local?.canvasJson   ?? null,
        techpackJson: techpackJson ?? local?.techpackJson ?? null,
      }
      porId.set(remoto.id, completo)
      await idbPut(STORE_PROJECTS, completo)
    }

    // 4. Lo que acá es más nuevo (o no existe arriba) se sube.
    const idsNube = new Map(nube.map(p => [p.id, p.updatedAt]))
    for (const local of locales as Pendiente[]) {
      const arriba = idsNube.get(local.id)
      // Se sube lo pendiente aunque la fecha de arriba parezca más nueva: esa
      // fecha la puso el servidor y no dice nada sobre el contenido.
      if (!local.pendienteDeSubir && arriba !== undefined && arriba >= local.updatedAt) continue
      await pushProject(local, userId)
    }

    return {
      projects: [...porId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      folders: [...carpetas.values()],
    }
  } catch {
    return null   // si el sync falla, lo local sigue siendo válido
  }
}
