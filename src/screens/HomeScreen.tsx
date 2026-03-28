import { useState } from 'react'
import { Project } from '../types/project'
import './HomeScreen.css'

interface Props {
  projects: Project[]
  onNewProject: () => void
  onOpenProject: (project: Project) => void
  onDeleteProject: (id: string) => void
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const MOCKUP_LABELS: Record<string, string> = {
  tshirt: 'Remera',
  hoodie: 'Hoodie',
  pants: 'Pantalon',
}

export default function HomeScreen({ projects, onNewProject, onOpenProject, onDeleteProject }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div className="home">
      {/* Sidebar */}
      <aside className="home-sidebar">
        <div className="home-logo">RAW</div>

        <button className="btn-new" onClick={onNewProject}>
          <span className="btn-new-icon">+</span>
          Nuevo proyecto
        </button>

        <div className="home-divider" />

        <div className="home-section-label">Recientes</div>
        <div className="home-recent-list">
          {projects.length === 0 && (
            <p className="home-recent-empty">Sin proyectos aun</p>
          )}
          {projects.map(p => (
            <div
              key={p.id}
              className={`home-recent-item ${hoveredId === p.id ? 'hovered' : ''}`}
              onClick={() => onOpenProject(p)}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="home-recent-icon">
                <img src={`/mockups/${p.mockupId}.svg`} alt={p.name} />
              </div>
              <div className="home-recent-info">
                <span className="home-recent-name">{p.name}</span>
                <span className="home-recent-date">{formatDate(p.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main area */}
      <main className="home-main">
        <div className="home-main-header">
          <h2>Proyectos recientes</h2>
        </div>

        {projects.length === 0 ? (
          <div className="home-empty-state">
            <div className="home-empty-icon">✦</div>
            <p>No hay proyectos todavia</p>
            <button className="btn-new" onClick={onNewProject}>
              <span className="btn-new-icon">+</span>
              Crear primer proyecto
            </button>
          </div>
        ) : (
          <div className="home-grid">
            {projects.map(p => (
              <div
                key={p.id}
                className="home-card"
                onClick={() => onOpenProject(p)}
              >
                <div className="home-card-thumb">
                  {p.thumbnail
                    ? <img src={p.thumbnail} alt={p.name} />
                    : <img src={`/mockups/${p.mockupId}.svg`} alt={p.name} className="home-card-mockup" />
                  }
                </div>
                <div className="home-card-footer">
                  <div className="home-card-info">
                    <span className="home-card-name">{p.name}</span>
                    <span className="home-card-meta">{MOCKUP_LABELS[p.mockupId]} · {formatDate(p.updatedAt)}</span>
                  </div>
                  <button
                    className="home-card-delete"
                    onClick={e => { e.stopPropagation(); onDeleteProject(p.id) }}
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
