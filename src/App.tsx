import { useState, useEffect } from 'react'
import { Project } from './types/project'
import HomeScreen from './screens/HomeScreen'
import NewProjectModal from './screens/NewProjectModal'

type Screen = 'home' | 'editor'

const STORAGE_KEY = 'raw-projects'

function loadProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  function handleNewProject() {
    setShowNewModal(true)
  }

  function handleCreateProject(project: Project) {
    setProjects(prev => [project, ...prev])
    setActiveProject(project)
    setShowNewModal(false)
    setScreen('editor')
  }

  function handleOpenProject(project: Project) {
    setActiveProject(project)
    setScreen('editor')
  }

  function handleDeleteProject(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  return (
    <>
      {screen === 'home' && (
        <HomeScreen
          projects={projects}
          onNewProject={handleNewProject}
          onOpenProject={handleOpenProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      {screen === 'editor' && activeProject && (
        <div style={{ color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 14 }}>Editor — {activeProject.name}</p>
          <button
            onClick={() => setScreen('home')}
            style={{ background: 'none', border: '1px solid #333', color: '#666', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            ← Volver al inicio
          </button>
        </div>
      )}

      {showNewModal && (
        <NewProjectModal
          onConfirm={handleCreateProject}
          onCancel={() => setShowNewModal(false)}
        />
      )}
    </>
  )
}
