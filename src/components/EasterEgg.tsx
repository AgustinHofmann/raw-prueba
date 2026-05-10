import { useEffect } from 'react'

export default function EasterEgg() {
  useEffect(() => {
    let buf = ''
    const burst = () => {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2
      const colors = ['var(--accent)', '#ffffff', 'var(--accent-2)', 'var(--surface-2)']
      for (let i = 0; i < 36; i++) {
        const piece = document.createElement('div')
        piece.className = 'ee-piece'
        const angle = Math.random() * Math.PI * 2
        const dist  = 140 + Math.random() * 360
        piece.style.left = cx + 'px'
        piece.style.top  = cy + 'px'
        piece.style.background = colors[i % colors.length]
        piece.style.setProperty('--dx', Math.cos(angle) * dist + 'px')
        piece.style.setProperty('--dy', Math.sin(angle) * dist + 'px')
        document.body.appendChild(piece)
        setTimeout(() => piece.remove(), 1200)
      }
    }
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (!/^[a-zA-Z]$/.test(e.key)) return
      buf = (buf + e.key.toLowerCase()).slice(-3)
      if (buf === 'raw') { burst(); buf = '' }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  return null
}
