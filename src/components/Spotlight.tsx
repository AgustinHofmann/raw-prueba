import { useEffect } from 'react'

export default function Spotlight({ on = true }: { on?: boolean }) {
  useEffect(() => {
    if (!on) return
    const el = document.querySelector('.spotlight') as HTMLElement | null
    if (!el) return
    el.classList.add('on')
    const handle = (e: MouseEvent) => {
      el.style.setProperty('--mx', e.clientX + 'px')
      el.style.setProperty('--my', e.clientY + 'px')
    }
    window.addEventListener('mousemove', handle)
    return () => {
      window.removeEventListener('mousemove', handle)
      el.classList.remove('on')
    }
  }, [on])
  return null
}
