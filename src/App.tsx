import { useState, useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Project, Folder } from './types/project'
import { fetchProjects, upsertProject, deleteProject, fetchFolders, upsertFolder, deleteFolder } from './lib/db'
import AuthScreen from './screens/AuthScreen'
import ProfilePanel from './components/ProfilePanel'
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

export default function App() {
  const [user, setUser]             = useState<User | null>(null)
  const [authReady, setAuthReady]   = useState(false)
  const [route, setRoute]           = useState<Route>('onboard')
  const [transition, setTransition] = useState(0)
  const [projects, setProjects]     = useState<Project[]>([])
  const [folders, setFolders]       = useState<Folder[]>([])
  const [activeProject, setActive]  = useState<Project | null>(null)
  const [openTabs, setOpenTabs]     = useState<Project[]>([])
  const [showSheet, setShowSheet]     = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [toast, setToast]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)
  const editorActionsRef = useRef<{ save: () => void; export: () => void } | null>(null)

  // Verifica sesión activa y escucha cambios de auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Carga proyectos y carpetas cuando hay usuario
  useEffect(() => {
    if (!user) { setProjects([]); setFolders([]); return }
    Promise.all([fetchProjects(), fetchFolders()])
      .then(([p, f]) => { setProjects(p); setFolders(f) })
      .catch(err => console.error('Error cargando datos:', err))
  }, [user])

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

  async function handleCreate(p: Project) {
    await upsertProject(p, user!.id)
    setProjects(prev => [p, ...prev])
    openProject(p)
    setShowSheet(false)
  }

  async function handleImport(p: Project) {
    await upsertProject(p, user!.id)
    setProjects(prev => [p, ...prev])
    openProject(p)
  }

  async function handleDelete(id: string) {
    await deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    closeTab(id)
    showToast('Proyecto eliminado')
  }

  async function handleCreateFolder(name: string) {
    const folder: Folder = { id: crypto.randomUUID(), name, createdAt: Date.now() }
    await upsertFolder(folder, user!.id)
    setFolders(prev => [folder, ...prev])
  }

  async function handleDeleteFolder(id: string) {
    const affected = projects.filter(p => p.folderId === id).map(p => ({ ...p, folderId: null }))
    await Promise.all([
      deleteFolder(id),
      ...affected.map(p => upsertProject(p, user!.id)),
    ])
    setFolders(prev => prev.filter(f => f.id !== id))
    setProjects(prev => prev.map(p => p.folderId === id ? { ...p, folderId: null } : p))
    showToast('Carpeta eliminada')
  }

  async function handleMoveProject(projectId: string, folderId: string | null) {
    const p = projects.find(p => p.id === projectId)
    if (!p) return
    const updated = { ...p, folderId }
    await upsertProject(updated, user!.id)
    setProjects(prev => prev.map(p => p.id === projectId ? updated : p))
  }

  async function handleSave(thumbnail: string, canvasJson: string) {
    if (!activeProject) return
    const updated = { ...activeProject, thumbnail, canvasJson, updatedAt: Date.now() }
    await upsertProject(updated, user!.id)
    setActive(updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  function handleSaveComplete() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
    showToast('Guardado ✓')
  }

  async function handleRename(name: string) {
    if (!activeProject) return
    const updated = { ...activeProject, name, updatedAt: Date.now() }
    await upsertProject(updated, user!.id)
    setActive(updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const exportProject = activeProject ?? projects[0] ?? null

  // Espera confirmación de sesión para evitar flash
  if (!authReady) return null

  // Sin sesión → pantalla de login
  if (!user) return <AuthScreen />

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
          email={user.email ?? ''}
          avatarUrl={user.user_metadata?.avatar_url}
          onHome={() => go('home')}
          onTabClick={openProject}
          onTabClose={closeTab}
          onNewProject={() => setShowSheet(true)}
          onSave={() => editorActionsRef.current?.save()}
          onExport={() => editorActionsRef.current?.export()}
          onRename={handleRename}
          onProfileOpen={() => setShowProfile(true)}
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

      {showProfile && (
        <ProfilePanel user={user} projects={projects} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}
