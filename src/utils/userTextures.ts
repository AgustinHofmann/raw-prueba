// Biblioteca de texturas propias del usuario.
//
// Se guardan en IndexedDB y no en localStorage: una foto de una muestra de tela
// pesa cientos de KB y localStorage (~5 MB, ya compartido con las tipografías)
// se llenaría con pocas telas. IndexedDB maneja cientos de MB.
//
// La textura queda disponible en TODOS los proyectos del usuario (es su
// biblioteca). Cuando se aplica a una prenda, la imagen viaja además dentro del
// diseño guardado, así el proyecto se ve igual desde otra computadora.

export interface UserTexture {
  id: string
  name: string
  dataUrl: string      // imagen embebida (png/jpg/webp/svg) o URL de una tela de fábrica
  widthCm: number      // ancho real de la muestra: define la escala del estampado
  createdAt: number
  builtIn?: boolean    // tela que viene con el programa: no se borra ni va a IndexedDB
}

// Formatos que el navegador decodifica de forma nativa. TIFF, PSD y AI quedan
// afuera a propósito: necesitarían una librería pesada y el diseñador siempre
// puede exportarlos a PNG/JPG.
export const TEXTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'
export const TEXTURE_MAX_MB = 8

const DB_NAME = 'raw-design'
const STORE   = 'user-textures'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error ?? new Error('No se pudo abrir la base local'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = run(t.objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror   = () => reject(r.error ?? new Error('Error de la base local'))
    t.oncomplete = () => db.close()
  }))
}

export async function listUserTextures(): Promise<UserTexture[]> {
  try {
    const all = await tx<UserTexture[]>('readonly', s => s.getAll() as IDBRequest<UserTexture[]>)
    return (all ?? []).sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }   // sin IndexedDB (modo privado) la app sigue andando
}

export async function deleteUserTexture(id: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(id) as unknown as IDBRequest<undefined>) } catch { /* noop */ }
}

export async function updateUserTexture(t: UserTexture): Promise<void> {
  await tx('readwrite', s => s.put(t) as unknown as IDBRequest<IDBValidKey>)
}

// Importa un archivo de imagen como textura del usuario.
// `widthCm` = cuánto mide en la realidad el ancho de la muestra. Es lo que
// permite que el estampado se dibuje a escala real sobre la prenda.
export async function importUserTexture(file: File, widthCm = 20): Promise<UserTexture> {
  const okType = TEXTURE_ACCEPT.split(',').includes(file.type)
  if (!okType) {
    throw new Error('Formato no soportado. Usá PNG, JPG, WebP o SVG.')
  }
  if (file.size > TEXTURE_MAX_MB * 1024 * 1024) {
    throw new Error(`La imagen supera ${TEXTURE_MAX_MB} MB. Exportala más chica.`)
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload  = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(file)
  })

  // Validar que sea una imagen que el navegador realmente puede dibujar:
  // una extensión correcta no garantiza un archivo sano.
  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve()
    img.onerror = () => reject(new Error('El archivo no es una imagen válida'))
    img.src = dataUrl
  })

  const tex: UserTexture = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Mi textura',
    dataUrl,
    widthCm: Math.min(200, Math.max(1, widthCm)),
    createdAt: Date.now(),
  }
  await updateUserTexture(tex)
  return tex
}
