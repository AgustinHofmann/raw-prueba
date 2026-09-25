import { useEffect, useRef, useState } from 'react'

/**
 * Selector de color propio.
 *
 * Reemplaza al `<input type="color">` del navegador, que abre el cuadro de
 * diálogo de Windows: se elige a ciegas, al soltar se cierra, y para corregir
 * un tono hay que volver a abrirlo. Elegir un color a ojo se volvía tedioso.
 *
 * Este se abre al lado de la muestra, **se queda abierto** y avisa el color en
 * VIVO mientras se arrastra, así se ve la prenda cambiar mientras se busca el
 * tono. Se cierra con Escape, clickeando afuera o con el botón.
 */

// ── hsv ⇄ hex ────────────────────────────────────────────────────────────────

function hsvAHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

function hexAHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return [h, max ? d / max : 0, max]
}

const esHex = (v: string) => /^#?[0-9a-f]{6}$/i.test(v.trim())
const normalizar = (v: string) => (v.trim().startsWith('#') ? v.trim() : '#' + v.trim()).toLowerCase()

interface Props {
  value: string
  onChange: (hex: string) => void
  /** Tamaño de la muestra que abre el selector. */
  size?: number
  title?: string
}

export default function ColorPicker({ value, onChange, size = 32, title }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexAHsv(value))
  const [texto, setTexto] = useState(value)
  const cajaRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const tonoRef = useRef<HTMLDivElement>(null)
  // Mientras se arrastra, el color lo manda el usuario: si se sincronizara con
  // la prop, cada aviso de cambio pisaría la posición del puntero.
  const arrastrando = useRef<null | 'area' | 'tono'>(null)

  useEffect(() => {
    if (arrastrando.current) return
    setHsv(hexAHsv(value)); setTexto(value)
  }, [value])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    // En captura: el lienzo de abajo se queda con muchos clics.
    document.addEventListener('mousedown', fuera, true)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera, true)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const emitir = (h: number, s: number, v: number) => {
    const hex = hsvAHex(h, s, v)
    setHsv([h, s, v]); setTexto(hex); onChange(hex)
  }

  const desdeArea = (e: MouseEvent | React.MouseEvent) => {
    const r = areaRef.current?.getBoundingClientRect(); if (!r) return
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    emitir(hsv[0], s, v)
  }
  const desdeTono = (e: MouseEvent | React.MouseEvent) => {
    const r = tonoRef.current?.getBoundingClientRect(); if (!r) return
    const h = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 360
    emitir(h, hsv[1], hsv[2])
  }

  useEffect(() => {
    if (!abierto) return
    const mover = (e: MouseEvent) => {
      if (arrastrando.current === 'area') desdeArea(e)
      else if (arrastrando.current === 'tono') desdeTono(e)
    }
    const soltar = () => { arrastrando.current = null }
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
    return () => {
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
    }
  }, [abierto, hsv])

  const [h, s, v] = hsv
  const actual = hsvAHex(h, s, v)

  return (
    <div ref={cajaRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title={title ?? 'Elegir color'}
        onClick={() => setAbierto(o => !o)}
        style={{
          width: size, height: size, borderRadius: 8, padding: 0, cursor: 'pointer',
          background: value, border: '2px solid ' + (abierto ? 'var(--accent)' : 'var(--line)'),
        }}
      />

      {abierto && (
        <div
          style={{
            // El panel de la derecha es angosto y recorta lo que se sale, así
            // que el selector tiene que entrar adentro: no puede abrirse hacia
            // afuera ni ser más ancho que la columna.
            position: 'absolute', top: size + 8, left: 0, zIndex: 400,
            width: 186, maxWidth: 'calc(100vw - 40px)',
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 10, padding: 10, boxShadow: 'var(--shadow-lg)',
            display: 'grid', gap: 9,
          }}
        >
          {/* Saturación y brillo */}
          <div
            ref={areaRef}
            onMouseDown={e => { arrastrando.current = 'area'; desdeArea(e) }}
            style={{
              position: 'relative', height: 112, borderRadius: 7, cursor: 'crosshair',
              background:
                `linear-gradient(to top, #000, transparent),
                 linear-gradient(to right, #fff, hsl(${h} 100% 50%))`,
            }}
          >
            <div style={{
              position: 'absolute', left: `${s * 100}%`, top: `${(1 - v) * 100}%`,
              width: 14, height: 14, marginLeft: -7, marginTop: -7,
              borderRadius: '50%', border: '2px solid #fff', background: actual,
              boxShadow: '0 0 0 1px rgb(0 0 0 / 0.5)', pointerEvents: 'none',
            }} />
          </div>

          {/* Tono */}
          <div
            ref={tonoRef}
            onMouseDown={e => { arrastrando.current = 'tono'; desdeTono(e) }}
            style={{
              position: 'relative', height: 14, borderRadius: 7, cursor: 'ew-resize',
              background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          >
            <div style={{
              position: 'absolute', left: `${(h / 360) * 100}%`, top: '50%',
              width: 14, height: 14, marginLeft: -7, marginTop: -7,
              borderRadius: '50%', border: '2px solid #fff',
              background: `hsl(${h} 100% 50%)`,
              boxShadow: '0 0 0 1px rgb(0 0 0 / 0.5)', pointerEvents: 'none',
            }} />
          </div>

          {/* Código, para pegar un color exacto */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 6, flexShrink: 0,
              background: actual, border: '1px solid var(--line)',
            }} />
            <input
              value={texto}
              onChange={e => {
                setTexto(e.target.value)
                if (esHex(e.target.value)) {
                  const hex = normalizar(e.target.value)
                  setHsv(hexAHsv(hex)); onChange(hex)
                }
              }}
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 12,
                textTransform: 'lowercase',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
