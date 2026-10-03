import { useState, useEffect } from 'react'
import Magnetic from '../components/Magnetic'

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
        {/* El slogan ES el lema de la primera pantalla: reemplaza al anterior
            ("Diseñá prendas, idea y crea sin vueltas"), no convive con él. */}
        <div className="display-i rise-2" style={{ fontSize: 'clamp(44px, 7vw, 100px)', color: 'var(--fg)', letterSpacing: '-0.025em' }}>
          For <span style={{ color: 'var(--accent)' }}>designers</span>,<br />
          by <em>designers</em>.
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
        {/* Los tres pasos del programa, en orden. Reemplazan a los contadores de
            mockups/proyectos/exports: eran números inventados que no decían nada
            de lo que la herramienta hace.
            Entran uno detrás del otro para que se lean como una secuencia y no
            como tres etiquetas sueltas. */}
        <div className="rise-5" style={{
          marginTop: 44, display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: 18, flexWrap: 'wrap',
          color: 'var(--muted)', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
        }}>
          {['Pensá', 'Diseñá', 'Exportá'].map((paso, i) => (
            <span key={paso} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              {i > 0 && <span style={{ opacity: 0.45 }}>→</span>}
              <span style={{
                color: step >= 2 ? 'var(--fg-2)' : 'var(--muted)',
                opacity: step >= 1 ? 1 : 0,
                transform: step >= 1 ? 'none' : 'translateY(6px)',
                transition: `opacity .5s var(--ease) ${i * 0.14}s, transform .5s var(--ease) ${i * 0.14}s, color .5s var(--ease)`,
              }}>{paso}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
