import { useState } from 'react'
import Logo from './Logo'
import { Project } from '../types/project'

type Route = 'onboard' | 'home' | 'library' | 'export' | 'editor'

interface Props {
  route: Route
  openTabs: Project[]
  activeProject: Project | null
  saved: boolean
  onHome: () => void
  onTabClick: (p: Project) => void
  onTabClose: (id: string) => void
  onNewProject: () => void
  onSave: () => void
  onExport: () => void
  onRename: (name: string) => void
}

export default function ChromeBar({
  route, openTabs, activeProject, saved,
  onHome, onTabClick, onTabClose, onNewProject,
  onSave, onExport, onRename,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const isEditor = route === 'editor' && activeProject !== null

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
      {/* Left section: logo + slogan + home button — 200px, matching sidebar width */}
      <div style={{
        width: 200, flexShrink: 0, display: 'flex', alignItems: 'center',
        paddingLeft: 12, gap: 0,
      }}>
        <Logo />

        {/* Home button — rectangular, fills height */}
        <button
          onClick={onHome}
          style={{
            marginLeft: 'auto', height: '100%', padding: '0 12px',
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

      {/* Separator — invisible but structural (matches the sidebar border) */}
      <div style={{ width: 1, background: 'var(--line-soft)', flexShrink: 0 }} />

      {/* Tabs section */}
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
                borderLeft: '1px solid ' + (active ? 'var(--line-soft)' : 'transparent'),
                borderRight: '1px solid ' + (active ? 'var(--line-soft)' : 'transparent'),
                borderTop: 'none',
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
            background: 'transparent', border: 'none', borderRadius: 0,
            color: 'var(--muted)', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s var(--ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--fg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)' }}
        >+</button>
      </div>

      {/* Right: editor controls or avatar */}
      {isEditor ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, flexShrink: 0 }}>
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
              title="Editar nombre (click)"
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
          <button className="btn btn-ghost" onClick={onSave} style={{ fontSize: 12, padding: '4px 12px', minWidth: 84 }}>
            {saved ? '✓ Guardado' : 'Guardar'}
          </button>
          <button className="btn btn-primary" onClick={onExport} style={{ fontSize: 12, padding: '4px 12px' }}>
            PNG ↓
          </button>
        </div>
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0, margin: 'auto 12px auto 0',
          background: 'color-mix(in oklch, var(--accent) 20%, var(--surface))',
          border: '1.5px solid var(--accent)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--display)',
        }}>A</div>
      )}
    </div>
  )
}
