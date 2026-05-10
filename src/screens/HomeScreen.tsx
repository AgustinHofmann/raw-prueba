import { useState, useRef } from 'react'
import { Project, Folder } from '../types/project'

interface Props {
  projects: Project[]
  folders: Folder[]
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
  hoodie: 'Hoodie',
  pants: 'Pantalón',
}

export default function HomeScreen({
  projects, folders,
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
  const importRef    = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

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
        </div>

        {visibleFolders.length === 0 && visibleProjects.length === 0 ? (
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
                onClick={() => onOpenProject(p)}
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

function ProjectCard({ project: p, folders, delay, onClick, onDelete, onMove, onDragStart }: {
  project: Project
  folders: Folder[]
  delay: number
  onClick: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const [hover, setHover]           = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [dragging, setDragging]     = useState(false)
  const gradient = p.colors?.length >= 2
    ? `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})`
    : 'var(--surface)'

  return (
    <div
      draggable
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowMoveMenu(false) }}
      onDragStart={e => { setDragging(true); onDragStart(e) }}
      onDragEnd={() => setDragging(false)}
      style={{
        borderRadius: 12, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'pointer',
        border: '1px solid ' + (hover ? 'var(--accent)' : 'var(--line)'),
        transition: 'all 0.2s var(--ease)',
        transform: hover && !dragging ? 'translateY(-2px)' : 'none',
        boxShadow: hover && !dragging ? 'var(--shadow-lg)' : 'none',
        opacity: dragging ? 0.4 : 1,
        animation: `rise 0.5s var(--ease) ${delay}s both`,
        position: 'relative',
      }}
    >
      <div style={{
        height: 120, background: gradient, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {p.thumbnail
          ? <img src={p.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <img src={`/mockups/${p.mockupId}.svg`} style={{ width: 60, height: 60, objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgb(0 0 0 / 0.3))' }} alt="" />
        }
        {hover && !dragging && (
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
