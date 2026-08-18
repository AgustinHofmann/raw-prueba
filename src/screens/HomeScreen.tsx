import { useState, useRef, useEffect } from 'react'
import { Project, Folder } from '../types/project'

interface Props {
  projects: Project[]
  folders: Folder[]
  loading?: boolean
  onNewProject: () => void
  onOpenProject: (project: Project) => void
  onDeleteProject: (id: string) => void
  onImportProject: (project: Project) => void
  onCreateFolder: (name: string) => void
  onDeleteFolder: (id: string) => void
  onMoveProject: (projectId: string, folderId: string | null) => void
}

const MOCKUP_LABELS: Record<string, string> = {
  tshirt: 'Remera',
  chomba: 'Chomba',
  pants: 'Pantalón',
}

export default function HomeScreen({
  projects, folders, loading,
  onNewProject, onOpenProject, onDeleteProject, onImportProject,
  onCreateFolder, onDeleteFolder, onMoveProject,
}: Props) {
  const [search, setSearch]                 = useState('')
  const [importError, setImportError]       = useState<string | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName]   = useState('')
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete]         = useState<Project | null>(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<Folder | null>(null)
  // Multi-selección
  const [selectMode, setSelectMode]       = useState(false)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)
  const [showBulkMove, setShowBulkMove]   = useState(false)
  const importRef      = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Ctrl+N → nuevo proyecto · Escape → salir del modo selección
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); onNewProject() }
      if (e.key === 'Escape' && selectMode) { e.preventDefault(); exitSelectMode() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNewProject, selectMode])

  function enterSelectMode(id?: string) {
    setSelectMode(true)
    if (id) setSelectedIds(new Set([id]))
  }
  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setShowBulkMove(false)
  }
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function bulkDelete() {
    selectedIds.forEach(id => onDeleteProject(id))
    setPendingBulkDelete(false)
    exitSelectMode()
  }
  function bulkMove(folderId: string | null) {
    selectedIds.forEach(id => onMoveProject(id, folderId))
    exitSelectMode()
  }
  function bulkExport() {
    projects.filter(p => selectedIds.has(p.id)).forEach(exportProjectFile)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string) as Project
        if (!data.id || !data.name || !data.mockupId) throw new Error('Formato inválido')
        onImportProject({ ...data, id: crypto.randomUUID(), updatedAt: Date.now() })
        setImportError(null)
      } catch {
        setImportError('El archivo no es un proyecto RAW válido.')
        setTimeout(() => setImportError(null), 3000)
      }
    }
    reader.readAsText(file)
  }

  function startCreatingFolder() {
    setNewFolderName('')
    setCreatingFolder(true)
    setTimeout(() => folderInputRef.current?.focus(), 0)
  }

  function commitFolder() {
    const name = newFolderName.trim()
    if (name) onCreateFolder(name)
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const activeFolder    = activeFolderId ? folders.find(f => f.id === activeFolderId) : null
  const visibleProjects = projects.filter(p => {
    const inFolder   = activeFolderId ? p.folderId === activeFolderId : p.folderId === null
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return inFolder && matchSearch
  })
  const visibleFolders = activeFolderId ? [] : folders

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Left rail */}
      <aside style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--line-soft)',
        display: 'flex', flexDirection: 'column', padding: '24px 16px', gap: 10,
      }}>
        <button
          onClick={onNewProject}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', fontSize: 13 }}
        >
          + Nuevo proyecto
        </button>

        {creatingFolder ? (
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onBlur={commitFolder}
            onKeyDown={e => {
              if (e.key === 'Enter') commitFolder()
              if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
            }}
            placeholder="Nombre de carpeta"
            style={{
              background: 'var(--surface)', border: '1px solid var(--accent)',
              borderRadius: 8, padding: '7px 10px', fontSize: 12,
              color: 'var(--fg)', fontFamily: 'var(--ui)', outline: 'none', width: '100%',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <button
            onClick={startCreatingFolder}
            className="btn btn-ghost"
            style={{ padding: '8px 12px', fontSize: 13, alignSelf: 'flex-start' }}
          >
            + Carpeta
          </button>
        )}

        <button
          onClick={() => importRef.current?.click()}
          className="btn btn-ghost"
          style={{ padding: '8px 12px', fontSize: 13, alignSelf: 'flex-start' }}
        >
          Abrir
        </button>

        {importError && (
          <p style={{ fontSize: 11, color: 'var(--danger)', lineHeight: 1.4, margin: 0 }}>{importError}</p>
        )}

        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />

        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 2 }}>
            <div>Ctrl+N &nbsp; nuevo</div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="scroll-hide" style={{ flex: 1, overflowY: 'auto', padding: '32px 44px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
          {activeFolder ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setActiveFolderId(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 13, fontFamily: 'var(--ui)',
                  padding: 0, display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                ← Archivo
              </button>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>/</span>
              <h1 className="display-i rise" style={{ fontSize: 'clamp(32px, 4vw, 56px)', margin: 0 }}>
                {activeFolder.name}
              </h1>
            </div>
          ) : (
            <h1 className="display-i rise" style={{ fontSize: 'clamp(40px, 5vw, 72px)' }}>
              Tu archivo.
            </h1>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar proyectos..."
              style={{
                height: 36, padding: '0 14px', borderRadius: 8,
                background: 'var(--surface)', border: '1px solid var(--line)',
                color: 'var(--fg)', fontFamily: 'var(--ui)', fontSize: 12,
                outline: 'none', width: 220,
              }}
            />
            <button
              onClick={() => selectMode ? exitSelectMode() : enterSelectMode()}
              className={selectMode ? 'btn btn-primary' : 'btn btn-ghost'}
              style={{ height: 36, padding: '0 14px', fontSize: 12, whiteSpace: 'nowrap' }}
              title="Seleccionar varios proyectos"
            >
              {selectMode ? 'Cancelar' : 'Seleccionar'}
            </button>
          </div>
        </div>

        {loading ? (
          // Skeleton mientras carga desde Supabase
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
            gap: 14,
          }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                borderRadius: 12, overflow: 'hidden',
                border: '1px solid var(--line)',
                animation: `rise 0.4s var(--ease) ${i * 0.04}s both`,
              }}>
                <div style={{
                  height: 120,
                  background: `linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%)`,
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.4s infinite',
                }} />
                <div style={{ padding: '10px 12px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 10, borderRadius: 4, background: 'var(--surface-2)', width: '70%' }} />
                  <div style={{ height: 8,  borderRadius: 4, background: 'var(--surface-2)', width: '45%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : visibleFolders.length === 0 && visibleProjects.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 240, gap: 16, color: 'var(--muted)',
          }}>
            <span style={{ fontSize: 32 }}>✦</span>
            <p style={{ fontSize: 14 }}>
              {search ? 'Sin resultados.' : activeFolderId ? 'Carpeta vacía.' : 'Todavía no hay proyectos.'}
            </p>
            {!search && !activeFolderId && (
              <button className="btn btn-primary" onClick={onNewProject} style={{ padding: '10px 18px', fontSize: 13 }}>
                + Nuevo proyecto
              </button>
            )}
          </div>
        ) : (
          <div className="rise-2" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
            gap: 14,
          }}>
            {visibleFolders.map((folder, i) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                projectCount={projects.filter(p => p.folderId === folder.id).length}
                delay={i * 0.03}
                isDragOver={dragOverFolder === folder.id}
                onClick={() => setActiveFolderId(folder.id)}
                onDelete={() => setPendingDeleteFolder(folder)}
                onDragOver={e => { e.preventDefault(); setDragOverFolder(folder.id) }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={e => {
                  e.preventDefault()
                  const projectId = e.dataTransfer.getData('projectId')
                  if (projectId) onMoveProject(projectId, folder.id)
                  setDragOverFolder(null)
                }}
              />
            ))}
            {visibleProjects.map((p, i) => (
              <ProjectCard
                key={p.id}
                project={p}
                folders={folders}
                delay={(visibleFolders.length + i) * 0.03}
                selectMode={selectMode}
                selected={selectedIds.has(p.id)}
                onClick={() => onOpenProject(p)}
                onToggleSelect={() => toggleSelect(p.id)}
                onLongPress={() => enterSelectMode(p.id)}
                onDelete={() => setPendingDelete(p)}
                onMove={folderId => onMoveProject(p.id, folderId)}
                onDragStart={e => {
                  e.dataTransfer.setData('projectId', p.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div
          onClick={() => setPendingDelete(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'rise 0.15s var(--ease) both',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 16, padding: '28px 32px', width: 340,
              display: 'flex', flexDirection: 'column', gap: 20,
              boxShadow: 'var(--shadow-lg)',
              animation: 'rise 0.2s var(--ease) both',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>
                ¿Eliminar proyecto?
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--fg)', fontWeight: 500 }}>"{pendingDelete.name}"</span> se eliminará permanentemente. Esta acción no se puede deshacer.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingDelete(null)}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '7px 16px' }}
                autoFocus
              >
                Cancelar
              </button>
              <button
                onClick={() => { onDeleteProject(pendingDelete.id); setPendingDelete(null) }}
                style={{
                  fontSize: 12, padding: '7px 16px', borderRadius: 8,
                  background: 'var(--danger, #e53935)', border: 'none',
                  color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete folder confirmation modal */}
      {pendingDeleteFolder && (
        <div
          onClick={() => setPendingDeleteFolder(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'rise 0.15s var(--ease) both',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 16, padding: '28px 32px', width: 340,
              display: 'flex', flexDirection: 'column', gap: 20,
              boxShadow: 'var(--shadow-lg)',
              animation: 'rise 0.2s var(--ease) both',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>
                ¿Eliminar carpeta?
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--fg)', fontWeight: 500 }}>"{pendingDeleteFolder.name}"</span> se eliminará. Los proyectos dentro quedarán sin carpeta.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingDeleteFolder(null)}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '7px 16px' }}
                autoFocus
              >
                Cancelar
              </button>
              <button
                onClick={() => { onDeleteFolder(pendingDeleteFolder.id); setPendingDeleteFolder(null) }}
                style={{
                  fontSize: 12, padding: '7px 16px', borderRadius: 8,
                  background: 'var(--danger, #e53935)', border: 'none',
                  color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de acciones de selección múltiple */}
      {selectMode && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
          zIndex: 150, display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 14,
          padding: '8px 10px', boxShadow: 'var(--shadow-lg)',
          animation: 'rise 0.2s var(--ease) both',
        }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', padding: '0 8px', whiteSpace: 'nowrap' }}>
            {selectedIds.size} {selectedIds.size === 1 ? 'seleccionado' : 'seleccionados'}
          </span>

          <button
            onClick={() => {
              const allSelected = visibleProjects.length > 0 && visibleProjects.every(p => selectedIds.has(p.id))
              setSelectedIds(allSelected ? new Set() : new Set(visibleProjects.map(p => p.id)))
            }}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '7px 12px', whiteSpace: 'nowrap' }}
          >
            {visibleProjects.length > 0 && visibleProjects.every(p => selectedIds.has(p.id)) ? 'Ninguno' : 'Todos'}
          </button>

          <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />

          {/* Mover a carpeta */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowBulkMove(v => !v)}
              disabled={selectedIds.size === 0}
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '7px 12px', whiteSpace: 'nowrap', opacity: selectedIds.size === 0 ? 0.4 : 1 }}
            >
              Mover
            </button>
            {showBulkMove && selectedIds.size > 0 && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 10,
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 8, overflow: 'hidden', minWidth: 160,
                boxShadow: 'var(--shadow-lg)', maxHeight: 240, overflowY: 'auto',
              }}>
                <button
                  onClick={() => bulkMove(null)}
                  style={{
                    width: '100%', padding: '9px 12px', background: 'none', border: 'none',
                    color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--ui)',
                    cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  Sin carpeta
                </button>
                {folders.length === 0 ? (
                  <div style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)' }}>No hay carpetas</div>
                ) : folders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => bulkMove(f.id)}
                    style={{
                      width: '100%', padding: '9px 12px', background: 'none', border: 'none',
                      color: 'var(--fg)', fontSize: 11, fontFamily: 'var(--ui)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    📁 {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { bulkExport(); }}
            disabled={selectedIds.size === 0}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '7px 12px', whiteSpace: 'nowrap', opacity: selectedIds.size === 0 ? 0.4 : 1 }}
          >
            Exportar
          </button>

          <button
            onClick={() => setPendingBulkDelete(true)}
            disabled={selectedIds.size === 0}
            style={{
              fontSize: 12, padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap',
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--ui)',
              color: 'var(--danger, #e53935)', opacity: selectedIds.size === 0 ? 0.4 : 1,
            }}
          >
            Eliminar
          </button>

          <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />

          <button
            onClick={exitSelectMode}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '7px 12px', whiteSpace: 'nowrap' }}
          >
            Listo
          </button>
        </div>
      )}

      {/* Confirmación de borrado masivo */}
      {pendingBulkDelete && (
        <div
          onClick={() => setPendingBulkDelete(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'rise 0.15s var(--ease) both',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 16, padding: '28px 32px', width: 340,
              display: 'flex', flexDirection: 'column', gap: 20,
              boxShadow: 'var(--shadow-lg)',
              animation: 'rise 0.2s var(--ease) both',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>
                ¿Eliminar {selectedIds.size} {selectedIds.size === 1 ? 'proyecto' : 'proyectos'}?
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Se eliminarán permanentemente. Esta acción no se puede deshacer.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingBulkDelete(false)}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '7px 16px' }}
                autoFocus
              >
                Cancelar
              </button>
              <button
                onClick={bulkDelete}
                style={{
                  fontSize: 12, padding: '7px 16px', borderRadius: 8,
                  background: 'var(--danger, #e53935)', border: 'none',
                  color: '#fff', cursor: 'pointer', fontFamily: 'var(--ui)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function exportProjectFile(p: Project) {
  const json = JSON.stringify(p, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${p.name.replace(/\s+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function FolderCard({ folder, projectCount, delay, isDragOver, onClick, onDelete, onDragOver, onDragLeave, onDrop }: {
  folder: Folder
  projectCount: number
  delay: number
  isDragOver: boolean
  onClick: () => void
  onDelete: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        border: '1.5px solid ' + (isDragOver ? 'var(--accent)' : hover ? 'var(--accent)' : 'var(--line)'),
        transition: 'all 0.2s var(--ease)',
        transform: isDragOver ? 'scale(1.04)' : hover ? 'translateY(-2px)' : 'none',
        boxShadow: isDragOver ? '0 0 0 4px color-mix(in oklch, var(--accent) 20%, transparent)' : hover ? 'var(--shadow-lg)' : 'none',
        background: isDragOver ? 'color-mix(in oklch, var(--accent) 8%, var(--bg))' : 'transparent',
        animation: `rise 0.5s var(--ease) ${delay}s both`,
      }}
    >
      <div style={{
        height: 120, background: 'var(--surface)', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 48, lineHeight: 1, transition: 'transform 0.2s', transform: isDragOver ? 'scale(1.2)' : 'none' }}>📁</span>
        {hover && !isDragOver && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Eliminar carpeta"
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 22, height: 22, borderRadius: '50%', background: 'rgb(0 0 0 / 0.5)',
              border: 'none', color: '#fff', fontSize: 10,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        )}
      </div>
      <div style={{ padding: '10px 12px', background: 'var(--surface)', borderTop: '1px solid var(--line-soft)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', marginBottom: 3 }}>{folder.name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
          {projectCount} {projectCount === 1 ? 'proyecto' : 'proyectos'}
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ project: p, folders, delay, selectMode, selected, onClick, onToggleSelect, onLongPress, onDelete, onMove, onDragStart }: {
  project: Project
  folders: Folder[]
  delay: number
  selectMode: boolean
  selected: boolean
  onClick: () => void
  onToggleSelect: () => void
  onLongPress: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const [hover, setHover]           = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [dragging, setDragging]     = useState(false)
  const longPressTimer = useRef<number | null>(null)
  const suppressClick  = useRef(false)
  const startPos       = useRef<{ x: number; y: number } | null>(null)
  const gradient = p.colors?.length >= 2
    ? `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`
    : 'var(--surface)'

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    startPos.current = null
  }
  function onPointerDown(e: React.PointerEvent) {
    suppressClick.current = false     // nuevo toque → limpia flag viejo (importante en táctil)
    if (selectMode) return            // en modo selección el click ya togglea
    startPos.current = { x: e.clientX, y: e.clientY }
    longPressTimer.current = window.setTimeout(() => {
      suppressClick.current = true     // evita que el click posterior abra el proyecto
      onLongPress()
      clearLongPress()
    }, 450)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!startPos.current) return
    const dx = Math.abs(e.clientX - startPos.current.x)
    const dy = Math.abs(e.clientY - startPos.current.y)
    if (dx > 8 || dy > 8) clearLongPress()   // se movió → es drag/scroll, no long-press
  }
  function handleClick() {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (selectMode) onToggleSelect()
    else onClick()
  }

  return (
    <div
      draggable={!selectMode}
      onClick={handleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearLongPress}
      onPointerLeave={clearLongPress}
      onContextMenu={e => { if (selectMode) e.preventDefault() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowMoveMenu(false) }}
      onDragStart={e => { setDragging(true); onDragStart(e) }}
      onDragEnd={() => setDragging(false)}
      style={{
        borderRadius: 12, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'pointer',
        border: '1px solid ' + (selected ? 'var(--accent)' : hover ? 'var(--accent)' : 'var(--line)'),
        transition: 'all 0.2s var(--ease)',
        transform: hover && !dragging ? 'translateY(-2px)' : 'none',
        boxShadow: selected
          ? '0 0 0 3px color-mix(in oklch, var(--accent) 35%, transparent)'
          : hover && !dragging ? 'var(--shadow-lg)' : 'none',
        opacity: dragging ? 0.4 : 1,
        animation: `rise 0.5s var(--ease) ${delay}s both`,
        position: 'relative',
        userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation',
      }}
    >
      <div style={{
        height: 120, background: gradient, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {p.thumbnail
          ? <img src={p.thumbnail} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <img src={`/mockups/${p.mockupId}.svg`} draggable={false} style={{ width: 60, height: 60, objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgb(0 0 0 / 0.3))' }} alt="" />
        }
        {/* Indicador de selección (círculo / check) */}
        {selectMode && (
          <div style={{
            position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: selected ? 'var(--accent)' : 'rgb(0 0 0 / 0.45)',
            border: '2px solid ' + (selected ? 'var(--accent)' : '#fff'),
            color: selected ? '#0a0a0a' : 'transparent', fontSize: 12, fontWeight: 700,
            backdropFilter: 'blur(4px)', transition: 'all 0.15s',
          }}>✓</div>
        )}
        {hover && !dragging && !selectMode && (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
            <button
              onClick={e => { e.stopPropagation(); exportProjectFile(p) }}
              title="Exportar proyecto (.json)"
              style={{
                width: 22, height: 22, borderRadius: '50%', background: 'rgb(0 0 0 / 0.5)',
                border: 'none', color: '#fff', fontSize: 10,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >↓</button>
            {folders.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); setShowMoveMenu(v => !v) }}
                title="Mover a carpeta"
                style={{
                  width: 22, height: 22, borderRadius: '50%', background: 'rgb(0 0 0 / 0.5)',
                  border: 'none', color: '#fff', fontSize: 10,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >⇥</button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              title="Eliminar proyecto"
              style={{
                width: 22, height: 22, borderRadius: '50%', background: 'rgb(0 0 0 / 0.5)',
                border: 'none', color: '#fff', fontSize: 10,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >✕</button>
          </div>
        )}
        {showMoveMenu && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 32, right: 6, zIndex: 10,
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 8, overflow: 'hidden', minWidth: 140,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {p.folderId !== null && (
              <button
                onClick={e => { e.stopPropagation(); onMove(null); setShowMoveMenu(false) }}
                style={{
                  width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                  color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--ui)',
                  cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--line-soft)',
                }}
              >
                Sin carpeta
              </button>
            )}
            {folders.map(f => (
              <button
                key={f.id}
                onClick={e => { e.stopPropagation(); onMove(f.id); setShowMoveMenu(false) }}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: p.folderId === f.id ? 'var(--surface)' : 'none',
                  border: 'none', color: 'var(--fg)', fontSize: 11, fontFamily: 'var(--ui)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                📁 {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', background: 'var(--surface)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', marginBottom: 3 }}>{p.name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
          {MOCKUP_LABELS[p.mockupId]} · {new Date(p.updatedAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
        </div>
      </div>
    </div>
  )
}
