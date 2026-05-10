import { useState, useEffect } from 'react'
import Magnetic from '../components/Magnetic'
import CountUp from '../components/CountUp'

export default function OnboardingScreen({ onEnter }: { onEnter: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t  = setTimeout(() => setStep(1), 600)
    const t2 = setTimeout(() => setStep(2), 1700)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [])

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: 'var(--bg)', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(closest-side, color-mix(in oklch, var(--accent) 10%, transparent), transparent 70%)',
        filter: 'blur(50px)', animation: 'rise 1.4s var(--ease) both',
      }} />
      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 720, padding: 32 }}>
        <div className="label rise" style={{ marginBottom: 28 }}>RAW · Atelier digital</div>
        <div className="display-i rise-2" style={{ fontSize: 'clamp(44px, 7vw, 100px)', color: 'var(--fg)', letterSpacing: '-0.025em' }}>
          Diseñá <span style={{ color: 'var(--accent)' }}>prendas</span><br />
          como un <em>editorial</em>.
        </div>
        <p className="rise-3" style={{ marginTop: 24, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 480, margin: '24px auto 0' }}>
          Mockups 2D, color, trazo libre y exportación lista para producción.
        </p>
        <div className="rise-4" style={{ marginTop: 36, display: 'inline-flex', gap: 10 }}>
          <Magnetic strength={10}>
            <button className="btn btn-primary" style={{ padding: '14px 22px', fontSize: 14 }} onClick={onEnter}>
              Entrar al estudio →
            </button>
          </Magnetic>
        </div>
        <div className="rise-5" style={{
          marginTop: 44, display: 'flex', justifyContent: 'center', gap: 56,
          color: 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          <div><CountUp to={step >= 2 ? 12 : 0} /> mockups</div>
          <div><CountUp to={step >= 2 ? 248 : 0} /> proyectos</div>
          <div><CountUp to={step >= 2 ? 36 : 0} suffix="k" /> exports</div>
        </div>
      </div>
    </div>
  )
}
