export const SYSTEM_FONTS = [
  'Arial', 'Georgia', 'Times New Roman', 'Courier New',
  'Verdana', 'Impact', 'Garamond', 'Palatino',
] as const

export const GOOGLE_FONTS = [
  // Editorial / serif
  'Playfair Display', 'Cormorant Garamond', 'Bodoni Moda',
  'DM Serif Display', 'EB Garamond', 'Libre Baskerville',
  // Sans / modern
  'Montserrat', 'Raleway', 'Josefin Sans', 'Poppins', 'Inter',
  // Display / impacto
  'Bebas Neue', 'Anton', 'Big Shoulders Display',
  // Mono
  'Space Mono', 'IBM Plex Mono',
  // Decorativo
  'Abril Fatface',
] as const

export type GoogleFont = typeof GOOGLE_FONTS[number]

const loadedGoogleFonts = new Set<string>()

export async function loadGoogleFont(family: string): Promise<void> {
  if (loadedGoogleFonts.has(family)) return
  loadedGoogleFonts.add(family)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}&display=swap`
  document.head.appendChild(link)
  await new Promise<void>(resolve => {
    link.onload = async () => {
      try { await document.fonts.load(`16px "${family}"`) } catch { /* fallback ok */ }
      resolve()
    }
    link.onerror = () => resolve()
    setTimeout(resolve, 4000)
  })
}

const STORAGE_KEY = 'raw-user-fonts'

type StoredFont = { data: string; mime: string }

function getStored(): Record<string, StoredFont> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function registerFont(name: string, source: ArrayBuffer | string): Promise<void> {
  const font = new FontFace(name, typeof source === 'string' ? source : source)
  const loaded = await font.load()
  document.fonts.add(loaded)
}

export async function loadUserFont(file: File): Promise<string> {
  const name = file.name.replace(/\.[^.]+$/, '')
  const buffer = await file.arrayBuffer()
  await registerFont(name, buffer)
  const stored = getStored()
  stored[name] = { data: toBase64(buffer), mime: file.type || 'font/truetype' }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch { /* quota ok */ }
  return name
}

export async function restoreUserFonts(): Promise<string[]> {
  const stored = getStored()
  const names: string[] = []
  for (const [name, { data }] of Object.entries(stored)) {
    try {
      await registerFont(name, fromBase64(data))
      names.push(name)
    } catch { /* corrupt entry, skip */ }
  }
  return names
}

export function deleteUserFont(name: string): void {
  const stored = getStored()
  delete stored[name]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}
