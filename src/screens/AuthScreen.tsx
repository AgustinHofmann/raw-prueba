import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import Magnetic from '../components/Magnetic'

type Mode = 'login' | 'signup'

export default function AuthScreen({ onSinCuenta }: { onSinCuenta?: () => void }) {
  const [mode, setMode]         = useState<Mode>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [ghLoading, setGhLoading] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [sent, setSent]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(translateError(error.message))
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(translateError(error.message))
      else setSent(true)
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setGhLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  function switchMode() {
    setMode(m => m === 'login' ? 'signup' : 'login')
    setError(null)
    setSent(false)
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'grid', placeItems: 'center',
      background: 'var(--bg)', overflow: 'hidden',
    }}>

      {/* Glow de fondo */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 50% at 50% 60%, color-mix(in oklch, var(--accent) 9%, transparent), transparent)',
        filter: 'blur(40px)',
        animation: 'rise 1.6s var(--ease) both',
      }} />

      <div style={{ position: 'relative', width: '100%', maxWidth: 400, padding: '0 20px' }}>

        {/* Logo */}
        <div className="rise" style={{ textAlign: 'center', marginBottom: 28 }}>
          <Logo size={30} />
        </div>

        {/* Título */}
        <div className="rise-2" style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 className="display-i" style={{ fontSize: 28, color: 'var(--fg)', marginBottom: 6 }}>
            {mode === 'login' ? 'Bienvenido de vuelta' : 'Crear cuenta'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
            {mode === 'login'
              ? 'Ingresá a tu estudio de diseño.'
              : 'Empezá a diseñar prendas hoy.'}
          </p>
        </div>

        {/* Card */}
        <div className="panel rise-3" style={{ padding: '28px 28px 24px' }}>

          {sent ? (
            <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', margin: '0 auto 14px',
                background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                display: 'grid', placeItems: 'center', fontSize: 22,
              }}>✉</div>
              <p style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                Revisá tu email para confirmar tu cuenta.
              </p>
              <button
                onClick={switchMode}
                style={{ marginTop: 16, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
              >
                ← Volver al login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 7 }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="vos@ejemplo.com"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label" style={{ display: 'block', marginBottom: 7 }}>Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <div style={{
                  fontSize: 12, color: 'var(--danger)', lineHeight: 1.5,
                  padding: '9px 12px', borderRadius: 'var(--radius-sm)',
                  background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--danger) 28%, transparent)',
                }}>
                  {error}
                </div>
              )}

              <Magnetic strength={6}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', marginTop: 2, fontSize: 13 }}
                >
                  {loading ? 'Cargando…' : mode === 'login' ? 'Entrar al estudio →' : 'Crear cuenta →'}
                </button>
              </Magnetic>
            </form>
          )}

          {/* Divider */}
          {!sent && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
                <span style={{ fontSize: 10, color: 'var(--muted-2)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>o</span>
                <div style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
              </div>

              {/* Google OAuth */}
              <button
                className="btn"
                onClick={handleGoogle}
                disabled={ghLoading}
                style={{ width: '100%', justifyContent: 'center', gap: 10, fontSize: 13 }}
              >
                {ghLoading ? (
                  <span style={{ opacity: 0.6 }}>Redirigiendo…</span>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continuar con Google
                  </>
                )}
              </button>
            </>
          )}
        </div>

        {/* Toggle login/signup */}
        {!sent && (
          <p className="rise-4" style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'var(--muted)' }}>
            {mode === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
            <button
              onClick={switchMode}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              }}
            >
              {mode === 'login' ? 'Registrate' : 'Ingresá'}
            </button>
          </p>
        )}

        {/* Entrar sin cuenta.
            Tener cuenta sirve para guardar en la nube y abrir los proyectos
            desde otra computadora, pero no debería ser el peaje para poder
            diseñar. Sin cuenta el programa funciona igual y todo se guarda en
            esta máquina. */}
        {onSinCuenta && !sent && (
          <div className="rise-4" style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line-soft)', textAlign: 'center' }}>
            <button
              onClick={onSinCuenta}
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            >
              Entrar sin cuenta
            </button>
            <p style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              Tus proyectos se guardan en esta computadora. Podés crear una cuenta
              más adelante y se suben solos.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Traduce mensajes de error de Supabase al español
function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials'))  return 'Email o contraseña incorrectos.'
  if (msg.includes('Email not confirmed'))         return 'Confirmá tu email antes de ingresar.'
  if (msg.includes('User already registered'))    return 'Ya existe una cuenta con ese email.'
  if (msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.'
  if (msg.includes('Unable to validate email'))   return 'Email inválido.'
  return msg
}
