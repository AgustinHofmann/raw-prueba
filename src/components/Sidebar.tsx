import Logo from './Logo'

type Route = 'home' | 'library' | 'export' | 'editor' | 'onboard'

export default function Sidebar({ onGo, active }: { onGo: (r: Route) => void; active: Route }) {
  const items: { k: Route; label: string; icon: string }[] = [
    { k: 'home',    label: 'Atelier',    icon: '▣' },
    { k: 'library', label: 'Biblioteca', icon: '◫' },
    { k: 'export',  label: 'Exportar',   icon: '⤓' },
  ]

  return (
    <aside style={{
      width: 200, flexShrink: 0, background: 'var(--bg)',
      borderRight: '1px solid var(--line-soft)',
      padding: '24px 16px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ padding: '8px 6px 22px' }}><Logo /></div>
      <button className="btn btn-primary" style={{ marginBottom: 20, justifyContent: 'center', fontSize: 12 }}
        onClick={() => onGo('home')}>
        <span style={{ fontSize: 14 }}>+</span> Nuevo proyecto
      </button>
      {items.map(it => (
        <button key={it.k} onClick={() => onGo(it.k)} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 10px', borderRadius: 8, fontSize: 13,
          background: active === it.k ? 'var(--surface)' : 'transparent',
          border: '1px solid ' + (active === it.k ? 'var(--line)' : 'transparent'),
          color: active === it.k ? 'var(--fg)' : 'var(--fg-2)',
          cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          transition: 'all 0.15s var(--ease)',
        }}>
          <span style={{ width: 18, color: active === it.k ? 'var(--accent)' : 'var(--muted)' }}>{it.icon}</span>
          {it.label}
        </button>
      ))}
    </aside>
  )
}
