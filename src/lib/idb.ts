// Base de datos local del navegador (IndexedDB).
//
// Un solo lugar para abrirla, porque IndexedDB versiona la base ENTERA: si dos
// módulos la abren con números de versión distintos, el que pide la más vieja
// falla. Antes las texturas la abrían por su cuenta en la versión 1; al sumar
// los proyectos hubo que centralizar el manejo acá.

const DB_NAME = 'raw-design'
const DB_VERSION = 2

export const STORE_TEXTURES = 'user-textures'
export const STORE_PROJECTS = 'projects'
export const STORE_FOLDERS  = 'folders'
/** Ids borrados estando sin conexión, para poder borrarlos también en la nube al volver. */
export const STORE_DELETED  = 'deleted'

let cached: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (cached) return cached
  cached = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of [STORE_TEXTURES, STORE_PROJECTS, STORE_FOLDERS, STORE_DELETED]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error ?? new Error('No se pudo abrir la base local'))
  })
  // Si falla una vez (modo privado, sin permisos), no dejar el rechazo cacheado
  // para siempre: que el próximo intento vuelva a probar.
  cached.catch(() => { cached = null })
  return cached
}

/** Corre una operación sobre un almacén. Devuelve null si la base no está disponible. */
export async function idbRun<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDb()
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode)
      const r = run(t.objectStore(store))
      r.onsuccess = () => resolve(r.result)
      r.onerror   = () => reject(r.error ?? new Error('Error de la base local'))
    })
  } catch {
    return null
  }
}

export const idbGetAll = <T>(store: string) =>
  idbRun<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>).then(v => v ?? [])

export const idbGet = <T>(store: string, id: string) =>
  idbRun<T>(store, 'readonly', s => s.get(id) as IDBRequest<T>)

export const idbPut = <T>(store: string, value: T) =>
  idbRun(store, 'readwrite', s => s.put(value) as unknown as IDBRequest<IDBValidKey>)

export const idbDelete = (store: string, id: string) =>
  idbRun(store, 'readwrite', s => s.delete(id) as unknown as IDBRequest<undefined>)
