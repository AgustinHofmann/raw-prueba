import { useState, useEffect, useRef } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Project, Folder, Tab, tabKey, TechPackMeasures, TechPackDoc } from './types/project'
import { fetchProjects, fetchProjectCanvas, fetchProjectTechpack, upsertProject, saveTechpackJson, deleteProject, fetchFolders, upsertFolder, deleteFolder } from './lib/db'
import AuthScreen from './screens/AuthScreen'
import ProfilePanel from './components/ProfilePanel'
import OnboardingScreen from './screens/OnboardingScreen'
import HomeScreen from './screens/HomeScreen'
import LibraryScreen from './screens/LibraryScreen'
import ExportScreen from './screens/ExportScreen'
import EditorScreen from './screens/EditorScreen'
import TechPackScreen from './screens/TechPackScreen'
import NewProjectSheet from './screens/NewProjectSheet'
import ChromeBar from './components/ChromeBar'
import Toast from './components/Toast'
import EasterEgg from './components/EasterEgg'
import PageTransition from './components/PageTransition'
import Spotlight from './components/Spotlight'

type Route = 'onboard' | 'home' | 'library' | 'export' | 'editor' | 'techpack'
export type Theme = 'dark' | 'light' | 'illustrator'

export default function App() {
  const [user, setUser]             = useState<User | null>(null)
  const [authReady, setAuthReady]   = useState(false)
  const [route, setRoute]           = useState<Route>('onboard')
  const [transition, setTransition] = useState(0)
  const [projects, setProjects]     = useState<Project[]>([])
  const [folders, setFolders]       = useState<Folder[]>([])
  const [activeProject, setActive]  = useState<Project | null>(null)
  const [openTabs, setOpenTabs]     = useState<Tab[]>([])
  const [loading, setLoading]         = useState(false)
  const [showSheet, setShowSheet]     = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [toast, setToast]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)
  const [theme, setTheme]           = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'illustrator')
  const editorActionsRef = useRef<{ save: () => void; export: () => void; importImage: (f: File) => void; placeImage: (f: File) => void; techpack: () => void } | null>(null)

  // Aplica y persiste el tema (dark = por defecto, sin atributo)
  useEffect(() => {
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

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
    setLoading(true)
    Promise.all([fetchProjects(), fetchFolders()])
      .then(([p, f]) => { setProjects(p); setFolders(f) })
      .catch(() => showToast('Error al cargar los proyectos'))
      .finally(() => setLoading(false))
  }, [user])

  const go = (r: Route) => setRoute(r)
  const showToast = (msg: string) => setToast(msg)

  async function openProject(p: Project) {
    // Si ya hay un tab de editor para este proyecto, reusá su versión en memoria (tiene canvas)
    const existing = openTabs.find(t => t.kind === 'editor' && t.project.id === p.id)
    if (existing) { setActive(existing.project); go('editor'); return }

    // Carga lazy del canvas_json solo al abrir
    let project = p
    if (!project.canvasJson) {
      try {
        const canvasJson = await fetchProjectCanvas(p.id)
        project = { ...p, canvasJson }
        setProjects(prev => prev.map(x => x.id === p.id ? project : x))
      } catch {
        showToast('Error al cargar el proyecto')
        return
      }
    }
    setActive(project)
    setOpenTabs(prev => [...prev, { kind: 'editor', project }])
    go('editor')
  }

  // Abre (o reenfoca y refresca) la pestaña de ficha técnica del proyecto activo,
  // en paralelo con el editor. La llama EditorScreen vía onOpenTechPack.
  async function openTechPackTab(snapshot: string, measures: TechPackMeasures | null) {
    const base = activeProject
    if (!base) return
    // Carga lazy del documento guardado
    let project = base
    if (project.techpackJson == null) {
      let techpackJson: string | null = null
      try { techpackJson = await fetchProjectTechpack(project.id) }
      catch { showToast('No se pudo cargar la ficha técnica guardada') }
      if (techpackJson != null) {
        project = { ...project, techpackJson }
        setProjects(prev => prev.map(x => x.id === project.id ? project : x))
      }
    }
    setOpenTabs(prev => {
      const exists = prev.some(t => t.kind === 'techpack' && t.project.id === project.id)
      if (exists) {
        return prev.map(t =>
          t.kind === 'techpack' && t.project.id === project.id
            ? { ...t, project, snapshot, measures }
            : t)
      }
      return [...prev, { kind: 'techpack', project, snapshot, measures }]
    })
    setActive(project)
    go('techpack')
  }

  // Persiste el documento de ficha técnica del proyecto activo
  async function handleSaveTechPack(doc: TechPackDoc) {
    const base = activeProject
    if (!base) return
    const json = JSON.stringify(doc)
    const updated = { ...base, techpackJson: json, updatedAt: Date.now() }
    setActive(updated)
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
    setOpenTabs(prev => prev.map(t => t.project.id === updated.id ? { ...t, project: updated } : t))
    // Un fallo al guardar TIENE que verse: mientras esto se tragaba en silencio,
    // la ficha técnica se perdía al recargar y nadie se enteraba.
    try { await saveTechpackJson(base.id, json) }
    catch { showToast('Error al guardar la ficha técnica — revisá tu conexión') }
  }

  // Activa una pestaña (editor o ficha técnica): proyecto activo + ruta correspondiente
  function activateTab(t: Tab) {
    setActive(t.project)
    go(t.kind)
  }

  function closeTab(t: Tab) {
    setOpenTabs(prev => {
      const next = prev.filter(x => tabKey(x) !== tabKey(t))
      const wasActive = activeProject?.id === t.project.id && route === t.kind
      if (wasActive) {
        const last = next[next.length - 1]
        if (last) { setActive(last.project); go(last.kind) }
        else { setActive(null); go('home') }
      }
      return next
    })
  }

  async function handleCreate(p: Project) {
    try {
      await upsertProject(p, user!.id)
      setProjects(prev => [p, ...prev])
      openProject(p)
      setShowSheet(false)
    } catch { showToast('Error al crear el proyecto') }
  }

  async function handleImport(p: Project) {
    try {
      await upsertProject(p, user!.id)
      setProjects(prev => [p, ...prev])
      openProject(p)
    } catch { showToast('Error al importar el proyecto') }
  }

  async function handleDelete(id: string) {
    try {
      await deleteProject(id)
      setProjects(prev => prev.filter(p => p.id !== id))
      // Purga ambas pestañas (editor + ficha técnica) del proyecto borrado
      setOpenTabs(prev => {
        const next = prev.filter(t => t.project.id !== id)
        if (activeProject?.id === id) {
          const last = next[next.length - 1]
          if (last) { setActive(last.project); go(last.kind) }
          else { setActive(null); go('home') }
        }
        return next
      })
      showToast('Proyecto eliminado')
    } catch { showToast('Error al eliminar el proyecto') }
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
    try {
      await upsertProject(updated, user!.id)
      setActive(updated)
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
      setOpenTabs(prev => prev.map(t => t.project.id === updated.id ? { ...t, project: updated } : t))
    } catch { showToast('Error al guardar — revisá tu conexión') }
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
    setOpenTabs(prev => prev.map(t => t.project.id === updated.id ? { ...t, project: updated } : t))
  }

  const exportProject = activeProject ?? projects[0] ?? null

  // Espera confirmación de sesión para evitar flash
  if (!authReady) return null

  // Sin sesión → pantalla de login
  if (!user) return <AuthScreen />

  const designerName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? 'Diseñador'
  // El editor se mantiene montado debajo de la ficha técnica para no perder el
  // lienzo/undo al alternar entre ambas pestañas del mismo proyecto.
  const hasEditorTab = activeProject != null && openTabs.some(t => t.kind === 'editor' && t.project.id === activeProject.id)
  const techPackTab = activeProject != null
    ? openTabs.find((t): t is Extract<Tab, { kind: 'techpack' }> => t.kind === 'techpack' && t.project.id === activeProject.id)
    : undefined

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
          onTabClick={activateTab}
          onTabClose={closeTab}
          onNewProject={() => setShowSheet(true)}
          onSave={() => editorActionsRef.current?.save()}
          onExport={() => editorActionsRef.current?.export()}
          onImportImage={(f: File) => editorActionsRef.current?.importImage(f)}
          onPlaceImage={(f: File) => editorActionsRef.current?.placeImage(f)}
          onTechPack={() => editorActionsRef.current?.techpack()}
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
            loading={loading}
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
        {(route === 'editor' || route === 'techpack') && activeProject && hasEditorTab && (
          <div style={{ display: route === 'techpack' ? 'none' : 'contents' }}>
            <EditorScreen
              key={activeProject.id}
              project={activeProject}
              designer={designerName}
              onSave={handleSave}
              saved={saved}
              onSaveComplete={handleSaveComplete}
              onActionsReady={a => { editorActionsRef.current = a }}
              onOpenTechPack={openTechPackTab}
              onToast={showToast}
            />
          </div>
        )}
        {route === 'techpack' && techPackTab && (
          <TechPackScreen
            key={'tp:' + techPackTab.project.id}
            project={techPackTab.project}
            designer={designerName}
            snapshot={techPackTab.snapshot}
            measures={techPackTab.measures}
            onSave={handleSaveTechPack}
            onBackToEditor={() => openProject(techPackTab.project)}
            onClose={() => closeTab(techPackTab)}
            onToast={showToast}
          />
        )}
      </div>

      {showSheet && (
        <NewProjectSheet folders={folders} onConfirm={handleCreate} onCancel={() => setShowSheet(false)} />
      )}

      {showProfile && (
        <ProfilePanel user={user} projects={projects} theme={theme} onThemeChange={setTheme} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}
