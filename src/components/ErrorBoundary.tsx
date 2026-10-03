import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Atrapa cualquier error de React y muestra qué pasó.
 *
 * Sin esto, un error al dibujar deja la pantalla vacía y en negro, sin una sola
 * pista: hay que abrir las herramientas del navegador para enterarse de algo.
 * Con esto el error se lee en la pantalla y se puede copiar.
 */
interface State { error: Error | null; info: string }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RAW Design] error al dibujar la pantalla', error, info)
    this.setState({ info: info.componentStack ?? '' })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        position: 'absolute', inset: 0, overflow: 'auto', padding: '40px 32px',
        background: 'var(--bg, #1b1d22)', color: 'var(--fg, #e8e4da)',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.6,
      }}>
        <h1 style={{ fontSize: 20, marginBottom: 6, fontFamily: 'system-ui, sans-serif' }}>
          Se rompió una pantalla
        </h1>
        <p style={{ color: 'var(--muted, #8a8a8a)', marginBottom: 20, fontFamily: 'system-ui, sans-serif' }}>
          El resto del programa sigue bien. Copiá esto y pasámelo.
        </p>

        <div style={{
          padding: '12px 14px', borderRadius: 8, marginBottom: 16,
          background: 'rgb(226 0 26 / 0.10)', border: '1px solid rgb(226 0 26 / 0.35)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <strong>{error.name}: {error.message}</strong>
          {error.stack && <div style={{ marginTop: 10, opacity: 0.75 }}>{error.stack}</div>}
        </div>

        {info && (
          <details>
            <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Dónde pasó</summary>
            <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.75, margin: 0 }}>{info}</pre>
          </details>
        )}

        <button
          onClick={() => { this.setState({ error: null, info: '' }) }}
          style={{
            marginTop: 22, padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
            background: 'transparent', color: 'inherit', border: '1px solid currentColor',
            fontFamily: 'system-ui, sans-serif', fontSize: 13,
          }}
        >
          Reintentar
        </button>
      </div>
    )
  }
}
