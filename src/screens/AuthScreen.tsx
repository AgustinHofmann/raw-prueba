import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import Magnetic from '../components/Magnetic'

type Mode = 'login' | 'signup'

export default function AuthScreen() {
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

  async function handleGitHub() {
    setGhLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'github',
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

              {/* GitHub OAuth */}
              <button
                className="btn"
                onClick={handleGitHub}
                disabled={ghLoading}
                style={{ width: '100%', justifyContent: 'center', gap: 10, fontSize: 13 }}
              >
                {ghLoading ? (
                  <span style={{ opacity: 0.6 }}>Redirigiendo…</span>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    Continuar con GitHub
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
