import { useState, useEffect } from 'react'
import Logo from './Logo'
import { Project, Tab, tabKey } from '../types/project'

type Route = 'onboard' | 'home' | 'library' | 'export' | 'editor' | 'techpack'

interface Props {
  route: Route
  openTabs: Tab[]
  activeProject: Project | null
  saved: boolean
  email: string
  avatarUrl?: string
  onHome: () => void
  onTabClick: (t: Tab) => void
  onTabClose: (t: Tab) => void
  onNewProject: () => void
  onSave: () => void
  onExport: () => void
  onImportImage: (f: File) => void
  onPlaceImage: (f: File) => void
  onTechPack: () => void
  onRename: (name: string) => void
  onProfileOpen: () => void
}

export default function ChromeBar({
  route, openTabs, activeProject, saved, email, avatarUrl,
  onHome, onTabClick, onTabClose, onNewProject,
  onSave, onExport, onImportImage, onPlaceImage, onTechPack, onRename, onProfileOpen,
}: Props) {
  const [editing, setEditing]     = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const isEditor = route === 'editor' && activeProject !== null

  // En pantalla completa la barra crece para aprovechar el espacio y verse más cómoda
  const barH    = isFullscreen ? 56 : 40
  const fsScale = isFullscreen ? 1.18 : 1

  // Abre el selector de archivos y ejecuta la acción elegida (importar / calco).
  // El diálogo nativo puede sacar la pantalla completa (API): intentamos re-entrar al volver.
  function pickImage(action: (f: File) => void) {
    const wasFs = !!document.fullscreenElement
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.png,.jpg,.jpeg,.webp,.gif,.bmp'
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) action(f)
      if (wasFs && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {})
      }
    }
    input.click()
    setFileMenuOpen(false)
  }

  const initial = (email?.[0] ?? '?').toUpperCase()

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  function startEdit() {
    if (!activeProject) return
    setNameInput(activeProject.name)
    setEditing(true)
  }

  function commitEdit() {
    setEditing(false)
    if (nameInput.trim()) onRename(nameInput.trim())
  }

  return (
    <div style={{
      height: barH, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid var(--line-soft)', background: 'var(--bg)',
      transition: 'height 0.18s var(--ease)',
    }}>

      {/* Left: logo clickeable + slogan + home button */}
      <div style={{
        width: 200, flexShrink: 0, display: 'flex', alignItems: 'center',
        paddingLeft: 12, gap: 0, overflow: 'hidden',
      }}>
        <button
          onClick={onHome}
          title="Volver al inicio"
          style={{
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            color: 'var(--fg)', transition: 'opacity 0.15s var(--ease)',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <Logo size={22} />
        </button>

        <span style={{
          flex: 1, marginLeft: 10, paddingLeft: 10, minWidth: 0,
          fontSize: 9, fontFamily: 'var(--ui)', color: 'var(--fg-2)',
          letterSpacing: '0.02em', lineHeight: 1.3,
          borderLeft: '1px solid var(--line-soft)',
          overflow: 'hidden',
        }}>
          diseño de<br />indumentaria
        </span>

        {/* Home button */}
        <button
          onClick={onHome}
          style={{
            flexShrink: 0, height: '100%', padding: '0 10px',
            background: route === 'home' ? 'var(--surface)' : 'transparent',
            borderLeft: '1px solid ' + (route === 'home' ? 'var(--line-soft)' : 'transparent'),
            borderRight: 'none', borderTop: 'none', borderBottom: 'none',
            borderRadius: 0,
            color: route === 'home' ? 'var(--fg)' : 'var(--fg-2)',
            fontSize: 12, fontFamily: 'var(--ui)', cursor: 'pointer',
            whiteSpace: 'nowrap', transition: 'all 0.15s var(--ease)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
          onMouseEnter={e => { if (route !== 'home') e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { if (route !== 'home') e.currentTarget.style.color = 'var(--fg-2)' }}
        >
          ⌂ Inicio
        </button>
      </div>

      <div style={{ width: 1, background: 'var(--line-soft)', flexShrink: 0 }} />

      {/* Tabs */}
      <div className="scroll-hide" style={{ flex: 1, display: 'flex', alignItems: 'stretch', overflowX: 'auto' }}>
        {openTabs.map(t => {
          const active = activeProject?.id === t.project.id && route === t.kind
          const isTP = t.kind === 'techpack'
          return (
            <button
              key={tabKey(t)}
              onClick={() => onTabClick(t)}
              title={isTP ? `Ficha técnica · ${t.project.name}` : t.project.name}
              style={{
                height: '100%', padding: '0 8px 0 14px', flexShrink: 0,
                background: active ? 'var(--surface)' : 'transparent',
                borderLeft: '1px solid var(--line-soft)',
                borderRight: 'none', borderTop: 'none',
                borderBottom: active
                  ? `2px ${isTP ? 'dashed' : 'solid'} var(--accent)`
                  : '2px solid transparent',
                borderRadius: 0,
                color: active ? 'var(--fg)' : 'var(--fg-2)',
                fontSize: 12, fontFamily: 'var(--ui)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap', transition: 'all 0.15s var(--ease)', maxWidth: 170,
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--fg)' }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-2)' }}}
            >
              {isTP && <span style={{ fontSize: 11, flexShrink: 0 }}>📄</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 96 }}>{t.project.name}</span>
              {isTP && <span className="mono" style={{ fontSize: 8, color: 'var(--muted)', flexShrink: 0, letterSpacing: '0.04em' }}>TP</span>}
              <span
                onClick={e => { e.stopPropagation(); onTabClose(t) }}
                style={{ fontSize: 10, color: 'var(--muted)', padding: '1px 3px', lineHeight: 1, flexShrink: 0 }}
              >✕</span>
            </button>
          )
        })}

        <button
          onClick={onNewProject}
          style={{
            width: 36, height: '100%', flexShrink: 0,
            background: 'transparent', borderRadius: 0,
            borderLeft: '1px solid var(--line-soft)', borderRight: 'none',
            borderTop: 'none', borderBottom: '2px solid transparent',
            color: 'var(--muted)', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s var(--ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)' }}
        >+</button>
      </div>

      {/* Right: controles editor + avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 10, flexShrink: 0 }}>

        {isEditor && (
          <>
            {editing ? (
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus
                style={{
                  background: 'var(--surface)', border: '1px solid var(--accent)',
                  borderRadius: 6, padding: '3px 8px', color: 'var(--fg)',
                  fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: 15,
                  outline: 'none', width: 160,
                }}
              />
            ) : (
              <button
                onClick={startEdit}
                title="Editar nombre"
                style={{
                  background: 'none', border: 'none', cursor: 'text',
                  fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: Math.round(15 * fsScale),
                  color: 'var(--fg)', padding: '3px 6px', borderRadius: 6,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                {activeProject!.name}
              </button>
            )}

            {/* Menú Archivo (estilo Illustrator) */}
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setFileMenuOpen(v => !v)}
                style={{ fontSize: Math.round(12 * fsScale), padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                Archivo <span style={{ fontSize: 9 }}>{fileMenuOpen ? '▴' : '▾'}</span>
              </button>

              {fileMenuOpen && (
                <>
                  {/* backdrop para cerrar al clickear afuera */}
                  <div onClick={() => setFileMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 91,
                    background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10,
                    boxShadow: 'var(--shadow-lg)', minWidth: 220, padding: 6,
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}>
                    <MenuItem icon="📥" label="Importar imagen"   hint="colocar tal cual" onClick={() => pickImage(onPlaceImage)} />
                    <MenuItem icon="🔀" label="Calco de imagen"   hint="vectorizar"       onClick={() => pickImage(onImportImage)} />
                    <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 0' }} />
                    <MenuItem icon="💾" label={saved ? 'Guardado ✓' : 'Guardar'} hint="Ctrl+S" onClick={() => { onSave(); setFileMenuOpen(false) }} />
                    <MenuItem icon="⬇" label="Exportar PNG"       hint="alta resolución"  onClick={() => { onExport(); setFileMenuOpen(false) }} />
                    <MenuItem icon="📄" label="Tech Pack"          hint="ficha técnica PDF" onClick={() => { onTechPack(); setFileMenuOpen(false) }} />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Pantalla completa */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Salir de pantalla completa (F11)' : 'Pantalla completa (F11)'}
          style={{
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            background: 'transparent', border: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--fg-2)', padding: 0, fontSize: 14,
            transition: 'all 0.15s var(--ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg-2)' }}
        >
          {isFullscreen ? '⛶' : '⛶'}
        </button>

        {/* Avatar — abre el panel de perfil */}
        <button
          onClick={onProfileOpen}
          title={email}
          style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
            border: '1.5px solid color-mix(in oklch, var(--accent) 50%, var(--line))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', overflow: 'hidden',
            transition: 'all 0.15s var(--ease)',
            padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'scale(1.05)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--accent) 50%, var(--line))'; e.currentTarget.style.transform = 'scale(1)' }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--ui)' }}>
              {initial}
            </span>
          )}
        </button>

      </div>
    </div>
  )
}

function MenuItem({ icon, label, hint, onClick }: {
  icon: string; label: string; hint?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer',
        padding: '8px 10px', textAlign: 'left', color: 'var(--fg)',
        fontFamily: 'var(--ui)', fontSize: 13,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{hint}</span>}
    </button>
  )
}
