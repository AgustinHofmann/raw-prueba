import { useState, useEffect } from 'react'

export default function CountUp({ to = 0, duration = 1100, suffix = '' }: { to?: number; duration?: number; suffix?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf: number, start: number
    const tick = (t: number) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / duration)
      setN(Math.round((1 - Math.pow(1 - p, 3)) * to))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, duration])
  return <span className="mono">{n}{suffix}</span>
}
