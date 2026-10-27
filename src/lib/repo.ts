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
  idbGetAll, idbGet, idbPut, idbDelete, pedirAlmacenamientoDurable,
} from './idb'
import {
  fetchProjects, fetchProjectCanvas, fetchProjectTechpack, upsertProject, deleteProject,
  fetchFolders, upsertFolder, deleteFolder,
} from './db'
import type { Project, Folder } from '../types/project'

/** Un borrado hecho sin conexión, esperando a poder aplicarse en la nube. */
interface Tombstone { id: string; kind: 'project' | 'folder'; at: number }

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/**
 * Plazo máximo para hablar con la nube. Pasado eso, se da por no contestada.
 *
 * Hace falta porque `navigator.onLine` miente: dice que hay internet con solo
 * tener wifi, aunque el servidor de la nube no conteste. Y una petición que no
 * contesta NO falla rápido: el navegador la deja colgada medio minuto o más.
 *
 * Eso era un bug visible, no un detalle. Con sesión abierta y la nube sin
 * contestar: crear un proyecto no abría el editor (la app esperaba a bajar un
 * dibujo que no existía todavía) y borrar tardaba 30 segundos en sacar la
 * tarjeta de la pantalla. Sin sesión las mismas dos cosas tardaban menos de un
 * segundo, que es la prueba de que lo que tardaba era la espera, no el trabajo.
 *
 * 8 segundos: de sobra para una conexión lenta de verdad, poco para que alguien
 * crea que el programa se colgó.
 */
const PLAZO_NUBE_MS = 8000

/**
 * Le pone plazo a una promesa de red. Si no contesta en tiempo, se resuelve
 * como si no hubiera nube.
 *
 * El trabajo de fondo NO se cancela: si la petición termina más tarde, termina.
 * Lo único que se corta es la espera, que es lo que tiene a alguien mirando una
 * pantalla que no reacciona.
 */
function conPlazo<T>(trabajo: Promise<T>, siNoContesta: T, ms = PLAZO_NUBE_MS): Promise<T> {
  return new Promise<T>(resolve => {
    const t = setTimeout(() => resolve(siNoContesta), ms)
    trabajo.then(
      v => { clearTimeout(t); resolve(v) },
      () => { clearTimeout(t); resolve(siNoContesta) },
    )
  })
}

/**
 * ¿Se puede hablar con la nube AHORA? Hace falta credenciales, red y sesión.
 *
 * Va con plazo porque `getSession()` no siempre es local: si el token está
 * vencido sale a la red a renovarlo, y ahí se cuelga igual que cualquier otra
 * petición. Era el primer eslabón de la espera.
 */
export async function cloudReady(): Promise<boolean> {
  if (!cloudEnabled || !isOnline()) return false
  return conPlazo(
    supabase.auth.getSession().then(({ data }) => Boolean(data.session)),
    false,
  )
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
  // Un proyecto recién creado no tiene dibujo en ningún lado: no nació con uno.
  // Salir a la nube a buscarlo es esperar por algo que no existe, y era
  // exactamente lo que impedía que el editor abriera al crear un proyecto.
  // La miniatura es la señal de que ALGUNA vez se guardó un dibujo.
  if (local != null && !local.thumbnail) return null
  if (!(await cloudReady())) return null
  const json = await conPlazo(fetchProjectCanvas(id), null)
  if (local && json != null) await idbPut(STORE_PROJECTS, { ...local, canvasJson: json })
  return json
}

export async function getTechpack(id: string): Promise<string | null> {
  const local = await idbGet<Project>(STORE_PROJECTS, id)
  if (local?.techpackJson != null) return local.techpackJson
  if (!(await cloudReady())) return null
  const json = await conPlazo(fetchProjectTechpack(id), null)
  if (local && json != null) await idbPut(STORE_PROJECTS, { ...local, techpackJson: json })
  return json
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
type Pendiente = Project & {
  pendienteDeSubir?: boolean
  /**
   * La fecha que tenía la copia de la NUBE la última vez que este dispositivo la
   * vio (subiéndola o bajándola). La pone el servidor.
   *
   * Es la pieza que faltaba para sincronizar bien entre dos dispositivos. No se
   * usa para saber cuál es más nueva —los relojes no son comparables— sino para
   * una pregunta que sí tiene respuesta exacta: **¿la nube cambió desde la
   * última vez que la vi?** Si es igual, no cambió. Si es distinta, alguien la
   * tocó en otro lado.
   *
   * Con eso alcanza para decidir sin adivinar:
   *   · cambió solo acá        → sube lo de acá
   *   · cambió solo en la nube → baja lo de la nube
   *   · cambiaron los dos      → CONFLICTO: no se pisa nada, se guardan ambos
   *   · no está en la nube y antes sí estaba → lo borraron en otro dispositivo
   */
  nubeVistaEn?: number
}

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
  // Se conserva `nubeVistaEn` del registro que ya estaba: es lo que este
  // dispositivo sabe de la nube, y guardar un cambio local no lo invalida.
  // Perderlo haría que el próximo sync no distinga "cambió solo acá" de
  // "cambiaron los dos", que es justo lo que hay que distinguir.
  // El mejor momento para pedir almacenamiento durable es cuando hay trabajo
  // real que perder, no al abrir la app: el navegador lo evalua mejor y, si
  // muestra un permiso, el usuario entiende por que se lo estan pidiendo.
  void pedirAlmacenamientoDurable()
  const previo = await idbGet<Pendiente>(STORE_PROJECTS, p.id)
  const conMarca: Pendiente = { ...p, pendienteDeSubir: true, nubeVistaEn: previo?.nubeVistaEn }
  const ok = (await idbPut(STORE_PROJECTS, conMarca)) !== null
  void pushProject(conMarca, userId)
  return ok
}

async function pushProject(p: Pendiente, userId?: string): Promise<void> {
  if (!(await cloudReady())) return
  try {
    // Con plazo: una subida colgada no tiene que dejar su promesa viva para
    // siempre. Si no contesta, `subio` queda en false y el proyecto se queda
    // marcado como pendiente, que es exactamente lo que corresponde.
    const subio = await conPlazo(
      upsertProject(p, userId).then(fecha => ({ fecha })),
      null,
    )
    if (!subio) return
    const fechaServidor = subio.fecha
    // Subió: se limpia la marca, pero solo si nadie volvió a guardar mientras
    // tanto (si la fecha cambió, hay cambios más nuevos todavía sin subir).
    const actual = await idbGet<Pendiente>(STORE_PROJECTS, p.id)
    if (actual && actual.updatedAt === p.updatedAt && actual.pendienteDeSubir) {
      await idbPut(STORE_PROJECTS, {
        ...actual,
        pendienteDeSubir: false,
        // Ahora la nube tiene EXACTAMENTE lo que hay acá, y se anota con qué
        // fecha quedó: así el próximo sync sabe que nadie más la tocó.
        nubeVistaEn: fechaServidor ?? actual.nubeVistaEn,
      })
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
  // La subida va de fondo, igual que la de un proyecto: la carpeta ya está
  // creada en esta máquina. Esperándola, crear una carpeta tardaba lo mismo que
  // tarde el servidor en contestar.
  void pushFolder(f, userId)
}

async function pushFolder(f: Folder, userId?: string): Promise<void> {
  if (!(await cloudReady())) return
  await conPlazo(upsertFolder(f, userId).then(() => true), false)
}

export async function removeProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id)
  await anotarBorrado(id, 'project')
  void borrarEnLaNube(id, 'project')
}

export async function removeFolder(id: string): Promise<void> {
  await idbDelete(STORE_FOLDERS, id)
  await anotarBorrado(id, 'folder')
  void borrarEnLaNube(id, 'folder')
}

// Un borrado no se puede perder: si solo se borrara local, el próximo sync lo
// bajaría de vuelta de la nube y reaparecería como un fantasma.
//
// El anotado va SIEMPRE y va PRIMERO, no solo cuando no hay internet. Antes se
// anotaba únicamente si el borrado de la nube tiraba error, y el caso que rompía
// era justo el que no tira error: la base contesta OK habiendo borrado cero
// filas. Como nadie anotaba nada, el proyecto seguía arriba y volvía al recargar.
//
// Esta parte SÍ se espera: es la que hace que el borrado sea definitivo, es
// local y tarda milisegundos.
async function anotarBorrado(id: string, kind: 'project' | 'folder'): Promise<void> {
  await idbPut<Tombstone>(STORE_DELETED, { id, kind, at: Date.now() })
}

// El borrado de la nube, en cambio, NO se espera: va de fondo, igual que la
// subida de un guardado (ver pushProject).
//
// Mientras se esperaba, apretar "Eliminar" dejaba la tarjeta en pantalla hasta
// medio minuto si el servidor no contestaba — la app parecía colgada cuando en
// realidad el proyecto ya estaba borrado de esta máquina desde el primer
// instante. Que la nube tarde, o no conteste nunca, no cambia nada: la
// anotación de arriba ya está puesta y el próximo sync reintenta.
//
// La anotación se levanta recién cuando la nube CONFIRMA el borrado.
async function borrarEnLaNube(id: string, kind: 'project' | 'folder'): Promise<void> {
  if (!(await cloudReady())) return
  const ok = await conPlazo(
    (kind === 'project' ? deleteProject(id) : deleteFolder(id)).then(() => true),
    false,
  )
  if (ok) await idbDelete(STORE_DELETED, id)
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
      const listo = await conPlazo(
        (t.kind === 'project' ? deleteProject(t.id) : deleteFolder(t.id)).then(() => true),
        false,
      )
      if (listo) await idbDelete(STORE_DELETED, t.id)
      /* si no contestó, queda anotado y se reintenta el próximo sync */
    }
    // Lo borrado acá NO vuelve, aunque la nube se haya negado a borrarlo. Sin
    // esta lista, una fila que la base no deja borrar (por ejemplo porque quedó
    // sin dueño) reaparecía en CADA arranque: el usuario la borraba una y otra
    // vez y siempre volvía. Mientras la anotación siga puesta, se la ignora.
    const borrados = new Set(
      (await idbGetAll<Tombstone>(STORE_DELETED)).map(t => t.id),
    )

    // 2. Carpetas: son livianas, se resuelven de una.
    //
    // OJO con el plazo acá: "no contestó" NO es lo mismo que "la nube está
    // vacía". Si una consulta vencida se tomara por lista vacía, el paso 4
    // concluiría que borraron todo en otro dispositivo y se llevaría puestos los
    // proyectos de esta máquina. Por eso vence en `null` y el sync se corta:
    // mejor no sincronizar que sincronizar contra una respuesta que no llegó.
    const [nubeCarpetas, localesCarpetas] = await Promise.all([
      conPlazo(fetchFolders().then(v => v as Folder[] | null), null),
      listFolders(),
    ])
    if (nubeCarpetas === null) return null
    const carpetas = new Map<string, Folder>()
    for (const f of nubeCarpetas) { if (!borrados.has(f.id)) carpetas.set(f.id, f) }
    for (const f of localesCarpetas) {
      if (!carpetas.has(f.id)) {
        carpetas.set(f.id, f)
        await conPlazo(upsertFolder(f, userId).then(() => true), false)   /* si no, el próximo sync */
      }
    }
    for (const f of carpetas.values()) await idbPut(STORE_FOLDERS, f)

    // 3. Proyectos. La lista de la nube viene sin el dibujo (es pesado), así que
    //    de los que ganan arriba hay que bajar el contenido aparte.
    const [nubeLista, locales] = await Promise.all([
      conPlazo(fetchProjects().then(v => v as Project[] | null), null),
      listProjects(),
    ])
    if (nubeLista === null) return null   // mismo criterio que con las carpetas
    const nube = nubeLista
    const porId = new Map<string, Project>()
    for (const p of locales) porId.set(p.id, p)

    /** Trae el contenido de la nube y lo deja guardado acá. */
    const bajar = async (remoto: Project, local?: Pendiente) => {
      const [canvasJson, techpackJson] = await Promise.all([
        conPlazo(fetchProjectCanvas(remoto.id), null),
        conPlazo(fetchProjectTechpack(remoto.id), null),
      ])
      // Si la nube no trae dibujo (falló la descarga, o esa fila nunca llegó a
      // guardarlo) se conserva el que hay acá. Pisar un diseño con vacío porque
      // la fila de arriba está más nueva es perder trabajo, y encima en silencio.
      const completo: Pendiente = {
        ...remoto,
        canvasJson:   canvasJson   ?? local?.canvasJson   ?? null,
        techpackJson: techpackJson ?? local?.techpackJson ?? null,
        pendienteDeSubir: false,
        nubeVistaEn: remoto.updatedAt,
      }
      porId.set(remoto.id, completo)
      await idbPut(STORE_PROJECTS, completo)
      return completo
    }

    const enNube = new Map(nube.map(p => [p.id, p]))
    const conflictos: string[] = []

    for (const remoto of nube) {
      if (borrados.has(remoto.id)) continue   // borrado acá: no vuelve
      const local = porId.get(remoto.id) as Pendiente | undefined
      if (!local) { await bajar(remoto); continue }

      // La única comparación que tiene sentido entre dos dispositivos: ¿la copia
      // de la nube es la MISMA que vi la última vez? Las fechas de los dos lados
      // salen de relojes distintos, así que no se pueden ordenar; pero preguntar
      // si son iguales sí vale.
      const nubeCambio = local.nubeVistaEn === undefined || local.nubeVistaEn !== remoto.updatedAt

      if (!local.pendienteDeSubir) {
        // Acá no hay nada sin subir: si la nube cambió, manda la nube.
        if (nubeCambio) await bajar(remoto, local)
        continue
      }

      // Acá hay cambios sin subir.
      if (!nubeCambio) continue      // la nube sigue igual → lo de acá es lo nuevo → se sube abajo

      // Cambiaron LOS DOS lados. Antes ganaba siempre el local y el trabajo del
      // otro dispositivo se perdía sin avisar. Ahora no se pisa nada: queda la
      // versión de la nube como el proyecto, y la de acá se guarda aparte como
      // una copia. Es feo tener dos, pero es lo único que no pierde trabajo.
      const mio: Pendiente = { ...local }
      const bajado = await bajar(remoto, local)

      // Salvo que las dos versiones digan lo mismo, que es lo más común: el
      // proyecto se subió desde otro dispositivo sin cambiar nada, o el dibujo
      // quedó igual. Duplicarlo ahí sería llenar el archivo de copias iguales.
      const igual =
        (mio.canvasJson   ?? '') === (bajado.canvasJson   ?? '') &&
        (mio.techpackJson ?? '') === (bajado.techpackJson ?? '') &&
        mio.name === bajado.name
      if (igual) continue
      const copia: Pendiente = {
        ...mio,
        id: crypto.randomUUID(),
        name: `${mio.name} (copia de este equipo)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pendienteDeSubir: true,
        nubeVistaEn: undefined,
      }
      await idbPut(STORE_PROJECTS, copia)
      porId.set(copia.id, copia)
      await pushProject(copia, userId)
      conflictos.push(mio.name)
    }

    // 4. Lo de acá que la nube todavía no tiene.
    for (const local of locales as Pendiente[]) {
      if (borrados.has(local.id)) continue
      const arriba = enNube.get(local.id)

      if (!arriba) {
        // No está en la nube. Si ANTES lo habíamos sincronizado, es que lo
        // borraron desde otro dispositivo: hay que borrarlo acá también. Sin
        // esto, el dispositivo que no se enteró lo volvía a subir y el proyecto
        // resucitaba una y otra vez — el "lo borré y no se borró".
        if (local.nubeVistaEn !== undefined) {
          await idbDelete(STORE_PROJECTS, local.id)
          porId.delete(local.id)
          continue
        }
        await pushProject(local, userId)   // nunca estuvo arriba: es nuevo de acá
        continue
      }

      // Está en los dos lados: solo se sube si acá hay algo sin subir Y la nube
      // no cambió por su cuenta (si cambió, ya se resolvió arriba como conflicto).
      if (local.pendienteDeSubir && local.nubeVistaEn === arriba.updatedAt) {
        await pushProject(local, userId)
      }
    }

    if (conflictos.length) {
      console.warn(
        '[RAW Design] Estos proyectos se editaron en dos dispositivos a la vez:\n' +
        conflictos.map(n => '  · ' + n).join('\n') +
        '\nSe conservó la versión de la nube y la de este equipo quedó guardada aparte como "(copia de este equipo)".',
      )
    }

    return {
      projects: [...porId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      folders: [...carpetas.values()],
    }
  } catch {
    return null   // si el sync falla, lo local sigue siendo válido
  }
}
