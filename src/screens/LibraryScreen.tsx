import Sidebar from '../components/Sidebar'
import TiltCard from '../components/TiltCard'

type Route = 'home' | 'library' | 'export' | 'editor' | 'onboard'

const swatches: [string, string[]][] = [
  ['Heritage',   ['#1a3530', '#3d5a4f', '#c4a47c', '#e9e1cf']],
  ['Streetwear', ['#0a0a0a', '#262626', '#a3a3a3', '#f4f4f5']],
  ['Reflex',     ['#0a1428', '#1e3a8a', '#3b82f6', '#e0f2fe']],
  ['Atelier',    ['#cdb4db', '#e9e1cf', '#fff',    '#0e0e0e']],
  ['Worker',     ['#3b2f1f', '#7a5e3a', '#c4a47c', '#e9e1cf']],
  ['Citrus',     ['#0a0a0a', '#a3e635', '#fff',    '#1f2a44']],
]

const patterns = [
  { id: 1, label: 'Stripes 03',  bg: 'repeating-linear-gradient(45deg, #111 0 8px, #1f1f1f 8px 16px)' },
  { id: 2, label: 'Dots wide',   bg: 'radial-gradient(circle at 50% 50%, #fff 2px, #0a0a0a 3px) 0 0/12px 12px' },
  { id: 3, label: 'Grid 8',      bg: 'linear-gradient(#a3e635 1px, transparent 1px) 0 0/12px 12px, linear-gradient(90deg, #a3e635 1px, transparent 1px) 0 0/12px 12px, #0a0a0a' },
  { id: 4, label: 'Wave',        bg: 'linear-gradient(135deg, #cdb4db, #e9e1cf)' },
  { id: 5, label: 'Static',      bg: 'radial-gradient(circle at 30% 30%, #fff 1px, #1a1a1a 2px) 0 0/6px 6px' },
  { id: 6, label: 'Bias',        bg: 'repeating-linear-gradient(-30deg, #c4a47c 0 6px, #1a3530 6px 14px)' },
]

export default function LibraryScreen({ onGo }: { onGo: (r: Route) => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)', overflow: 'hidden' }}>
      <Sidebar onGo={onGo} active="library" />
      <main className="scroll-hide" style={{ flex: 1, overflowY: 'auto', padding: '44px 56px 80px' }}>
        <div className="rise" style={{ marginBottom: 36 }}>
          <div className="label" style={{ marginBottom: 12 }}>Biblioteca · curada por la casa</div>
          <h1 className="display" style={{ fontSize: 'clamp(48px, 6vw, 88px)' }}>
            Recursos que <span className="display-i" style={{ color: 'var(--accent)' }}>activan</span> ideas.
          </h1>
        </div>

        <div className="rise-2" style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <h2 className="display-i" style={{ fontSize: 28 }}>Paletas</h2>
            <span className="label">{swatches.length} colecciones</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {swatches.map(([name, cols], i) => (
              <TiltCard key={i} className="rise-3" style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 14, padding: 16, cursor: 'pointer',
                animationDelay: 0.05 + i * 0.04 + 's',
              }}>
                <div style={{ display: 'flex', height: 90, borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                  {cols.map((c, j) => <div key={j} style={{ flex: 1, background: c }} />)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{cols.length} tonos</span>
                </div>
              </TiltCard>
            ))}
          </div>
        </div>

        <div className="rise-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <h2 className="display-i" style={{ fontSize: 28 }}>Estampados</h2>
            <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }}>+ Subir propio</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            {patterns.map((p, i) => (
              <div key={p.id} style={{
                aspectRatio: '1', borderRadius: 12, overflow: 'hidden',
                background: p.bg, border: '1px solid var(--line)',
                position: 'relative', cursor: 'pointer',
                transition: 'transform 0.3s var(--ease)',
                animation: `rise 0.5s var(--ease) ${0.05 + i * 0.04}s both`,
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <div style={{
                  position: 'absolute', left: 10, bottom: 10, padding: '4px 10px',
                  background: 'rgb(0 0 0 / 0.5)', color: '#fff', borderRadius: 999,
                  fontSize: 10, backdropFilter: 'blur(6px)',
                }}>{p.label}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
