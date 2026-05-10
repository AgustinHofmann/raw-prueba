import { useState, useEffect, useRef } from 'react'
import { Project, Folder } from './types/project'
import OnboardingScreen from './screens/OnboardingScreen'
import HomeScreen from './screens/HomeScreen'
import LibraryScreen from './screens/LibraryScreen'
import ExportScreen from './screens/ExportScreen'
import EditorScreen from './screens/EditorScreen'
import NewProjectSheet from './screens/NewProjectSheet'
import ChromeBar from './components/ChromeBar'
import Toast from './components/Toast'
import EasterEgg from './components/EasterEgg'
import PageTransition from './components/PageTransition'
import Spotlight from './components/Spotlight'

type Route = 'onboard' | 'home' | 'library' | 'export' | 'editor'

const STORAGE_KEY = 'raw-projects'
const FOLDERS_KEY = 'raw-folders'

function loadProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Project[]
    return raw.map(p => ({ folderId: null, ...p }))
  }
  catch { return [] }
}

function saveProjects(p: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

function loadFolders(): Folder[] {
  try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]') }
  catch { return [] }
}

function saveFolders(f: Folder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(f))
}

export default function App() {
  const [route, setRoute]           = useState<Route>('onboard')
  const [transition, setTransition] = useState(0)
  const [projects, setProjects]     = useState<Project[]>(loadProjects)
  const [folders, setFolders]       = useState<Folder[]>(loadFolders)
  const [activeProject, setActive]  = useState<Project | null>(null)
  const [openTabs, setOpenTabs]     = useState<Project[]>([])
  const [showSheet, setShowSheet]   = useState(false)
  const [toast, setToast]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)
  const editorActionsRef = useRef<{ save: () => void; export: () => void } | null>(null)

  useEffect(() => { saveProjects(projects) }, [projects])
  useEffect(() => { saveFolders(folders) }, [folders])

  const go = (r: Route) => setRoute(r)
  const showToast = (msg: string) => setToast(msg)

  function openProject(p: Project) {
    setActive(p)
    setOpenTabs(prev => prev.find(t => t.id === p.id) ? prev : [...prev, p])
    go('editor')
  }

  function closeTab(id: string) {
    setOpenTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (activeProject?.id === id) {
        const last = next[next.length - 1]
        if (last) setActive(last)
        else { setActive(null); go('home') }
      }
      return next
    })
  }

  function handleCreate(p: Project) {
    setProjects(prev => [p, ...prev])
    openProject(p)
    setShowSheet(false)
  }

  function handleImport(p: Project) {
    setProjects(prev => [p, ...prev])
    openProject(p)
  }

  function handleDelete(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
    closeTab(id)
    showToast('Proyecto eliminado')
  }

  function handleCreateFolder(name: string) {
    const folder: Folder = { id: crypto.randomUUID(), name, createdAt: Date.now() }
    setFolders(prev => [folder, ...prev])
  }

  function handleDeleteFolder(id: string) {
    setFolders(prev => prev.filter(f => f.id !== id))
    setProjects(prev => prev.map(p => p.folderId === id ? { ...p, folderId: null } : p))
    showToast('Carpeta eliminada')
  }

  function handleMoveProject(projectId: string, folderId: string | null) {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, folderId } : p))
  }

  function handleSave(thumbnail: string, canvasJson: string) {
    if (!activeProject) return
    const updated = { ...activeProject, thumbnail, canvasJson, updatedAt: Date.now() }
    setActive(updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  function handleSaveComplete() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
    showToast('Guardado ✓')
  }

  function handleRename(name: string) {
    if (!activeProject) return
    const updated = { ...activeProject, name, updatedAt: Date.now() }
    setActive(updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const exportProject = activeProject ?? projects[0] ?? null

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="spotlight" />
      <Spotlight />
      <PageTransition trigger={transition} />
      <EasterEgg />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {route !== 'onboard' && (
        <ChromeBar
          route={route}
          openTabs={openTabs}
          activeProject={activeProject}
          saved={saved}
          onHome={() => go('home')}
          onTabClick={openProject}
          onTabClose={closeTab}
          onNewProject={() => setShowSheet(true)}
          onSave={() => editorActionsRef.current?.save()}
          onExport={() => editorActionsRef.current?.export()}
          onRename={handleRename}
        />
      )}

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {route === 'onboard'  && <OnboardingScreen onEnter={() => { setTransition(t => t + 1); go('home') }} />}
        {route === 'home'     && (
          <HomeScreen
            projects={projects}
            folders={folders}
            onNewProject={() => setShowSheet(true)}
            onOpenProject={openProject}
            onDeleteProject={handleDelete}
            onImportProject={handleImport}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            onMoveProject={handleMoveProject}
          />
        )}
        {route === 'library'  && <LibraryScreen onGo={go} />}
        {route === 'export'   && exportProject && (
          <ExportScreen project={exportProject} onGo={go} onBack={() => go('home')} />
        )}
        {route === 'editor'   && activeProject && (
          <EditorScreen
            key={activeProject.id}
            project={activeProject}
            onSave={handleSave}
            saved={saved}
            onSaveComplete={handleSaveComplete}
            onActionsReady={a => { editorActionsRef.current = a }}
          />
        )}
      </div>

      {showSheet && (
        <NewProjectSheet folders={folders} onConfirm={handleCreate} onCancel={() => setShowSheet(false)} />
      )}
    </div>
  )
}
