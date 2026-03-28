import { useState, useEffect } from 'react'
import { Project } from './types/project'
import HomeScreen from './screens/HomeScreen'
import NewProjectModal from './screens/NewProjectModal'
import EditorScreen from './screens/EditorScreen'

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
        <EditorScreen
          project={activeProject}
          onBack={() => setScreen('home')}
          onSave={(thumbnail) => {
            setProjects(prev => prev.map(p =>
              p.id === activeProject.id
                ? { ...p, thumbnail, updatedAt: Date.now() }
                : p
            ))
          }}
        />
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
