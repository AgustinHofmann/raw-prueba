import { useState } from 'react'
import Logo from './Logo'
import { Project } from '../types/project'

type Route = 'onboard' | 'home' | 'library' | 'export' | 'editor'

interface Props {
  route: Route
  openTabs: Project[]
  activeProject: Project | null
  saved: boolean
  email: string
  avatarUrl?: string
  onHome: () => void
  onTabClick: (p: Project) => void
  onTabClose: (id: string) => void
  onNewProject: () => void
  onSave: () => void
  onExport: () => void
  onImportImage: (f: File) => void
  onRename: (name: string) => void
  onProfileOpen: () => void
}

export default function ChromeBar({
  route, openTabs, activeProject, saved, email, avatarUrl,
  onHome, onTabClick, onTabClose, onNewProject,
  onSave, onExport, onImportImage, onRename, onProfileOpen,
}: Props) {
  const [editing, setEditing]     = useState(false)
  const [nameInput, setNameInput] = useState('')
  const isEditor = route === 'editor' && activeProject !== null

  const initial = (email?.[0] ?? '?').toUpperCase()

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
      height: 40, flexShrink: 0, display: 'flex', alignItems: 'stretch',
      borderBottom: '1px solid var(--line-soft)', background: 'var(--bg)',
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
          const active = activeProject?.id === t.id && isEditor
          return (
            <button
              key={t.id}
              onClick={() => onTabClick(t)}
              style={{
                height: '100%', padding: '0 8px 0 14px', flexShrink: 0,
                background: active ? 'var(--surface)' : 'transparent',
                borderLeft: '1px solid var(--line-soft)',
                borderRight: 'none', borderTop: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                borderRadius: 0,
                color: active ? 'var(--fg)' : 'var(--fg-2)',
                fontSize: 12, fontFamily: 'var(--ui)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap', transition: 'all 0.15s var(--ease)', maxWidth: 160,
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--fg)' }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-2)' }}}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 96 }}>{t.name}</span>
              <span
                onClick={e => { e.stopPropagation(); onTabClose(t.id) }}
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
                  fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: 15,
                  color: 'var(--fg)', padding: '3px 6px', borderRadius: 6,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                {activeProject!.name}
              </button>
            )}
            <button
              className="btn btn-ghost"
              title="Importar imagen y vectorizar"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.png,.jpg,.jpeg,.webp,.gif,.bmp'
                input.onchange = () => {
                  const f = input.files?.[0]
                  if (f) onImportImage(f)
                }
                input.click()
              }}
            >
              🖼 Importar
            </button>
            <button className="btn btn-ghost" onClick={onSave} style={{ fontSize: 12, padding: '4px 12px', minWidth: 84 }}>
              {saved ? '✓ Guardado' : 'Guardar'}
            </button>
            <button className="btn btn-primary" onClick={onExport} style={{ fontSize: 12, padding: '4px 12px' }}>
              PNG ↓
            </button>
          </>
        )}

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
