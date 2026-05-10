import { useRef, useEffect } from 'react'

export default function PageTransition({ trigger }: { trigger: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (trigger === 0) return
    const el = ref.current
    if (!el) return
    el.classList.remove('run')
    void el.offsetWidth
    el.classList.add('run')
  }, [trigger])
  return <div ref={ref} className="page-mask" />
}
