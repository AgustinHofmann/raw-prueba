import { useRef, ReactNode, CSSProperties } from 'react'

export default function TiltCard({
  children, max = 6, className = '', style = {}, onClick,
}: {
  children: ReactNode
  max?: number
  className?: string
  style?: CSSProperties
  onClick?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateY(-4px)`
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = 'perspective(900px) rotateX(0) rotateY(0) translateY(0)'
  }
  return (
    <div ref={ref} className={`tilt ${className}`} style={style}
      onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick}>
      {children}
    </div>
  )
}
