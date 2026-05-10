import { useRef, ReactNode } from 'react'

export default function Magnetic({ children, strength = 18 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = ((e.clientX - r.left) / r.width - 0.5) * strength
    const dy = ((e.clientY - r.top) / r.height - 0.5) * strength
    el.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = 'translate(0,0)'
  }
  return (
    <span ref={ref} className="mag" onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ display: 'inline-flex' }}>
      {children}
    </span>
  )
}
