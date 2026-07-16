import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Project } from '../types/project'
import type { Theme } from '../App'
import { supabase } from '../lib/supabase'
import { fetchMyNickname, saveNickname, NICKNAME_RE } from '../lib/db'

interface Props {
  user: User
  projects: Project[]
  theme: Theme
  onThemeChange: (t: Theme) => void
  onClose: () => void
}

const THEMES: { id: Theme; label: string; swatch: [string, string, string] }[] = [
  { id: 'dark',        label: 'Oscuro',      swatch: ['#272a30', '#3a3e46', '#dfff57'] },
  { id: 'light',       label: 'Claro',       swatch: ['#ffffff', '#e9ebef', '#a6d400'] },
  { id: 'illustrator', label: 'Gris (AI)',   swatch: ['#3a3a3a', '#535353', '#dfff57'] },
]

function formatJoinDate(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return `${date} a las ${time}`
}

export default function ProfilePanel({ user, projects, theme, onThemeChange, onClose }: Props) {
  const meta       = user.user_metadata ?? {}
  const name       = meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? 'Usuario'
  const avatar     = meta.avatar_url as string | undefined
  const initial    = (user.email?.[0] ?? '?').toUpperCase()
  const joinedAt   = formatJoinDate(user.created_at)
  const totalGarments = projects.length

  // ── Nickname (tabla profiles, ver supabase/security.sql) ──
  const [nickname, setNickname] = useState<string | null>(null)
  const [nickDraft, setNickDraft] = useState<string | null>(null)  // null = no editando
  const [nickBusy, setNickBusy] = useState(false)
  const [nickErr, setNickErr] = useState<string | null>(null)

  useEffect(() => {
    fetchMyNickname(user.id).then(setNickname).catch(() => {})
  }, [user.id])

  async function handleNickSave() {
    const draft = (nickDraft ?? '').trim()
    if (draft === (nickname ?? '')) { setNickDraft(null); setNickErr(null); return }
    setNickBusy(true); setNickErr(null)
    try {
      await saveNickname(user.id, draft)
      setNickname(draft)
      setNickDraft(null)
    } catch (e) {
      setNickErr(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setNickBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgb(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'flex-end',
        animation: 'rise 0.2s var(--ease) both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, height: '100%',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          animation: 'sheet-in 0.3s var(--ease) both',
        }}
      >

        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px 18px',
          borderBottom: '1px solid var(--line-soft)',
        }}>
          <span className="label">Perfil</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none',
            color: 'var(--muted)', cursor: 'pointer',
            fontSize: 15, lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>

        {/* Avatar + datos principales */}
        <div style={{ padding: '28px 24px 24px', borderBottom: '1px solid var(--line-soft)' }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>

            {/* Avatar */}
            {avatar ? (
              <img
                src={avatar}
                alt={name}
                referrerPolicy="no-referrer"
                style={{
                  width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                  border: '2px solid color-mix(in oklch, var(--accent) 50%, var(--line))',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div style={{
                width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
                border: '2px solid color-mix(in oklch, var(--accent) 50%, var(--line))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--ui)',
              }}>
                {initial}
              </div>
            )}

            {/* Nombre + email */}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 17, fontFamily: 'var(--display)', fontStyle: 'italic',
                color: 'var(--fg)', marginBottom: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}
              </div>
              <div style={{
                fontSize: 12, color: 'var(--muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {user.email}
              </div>
            </div>
          </div>

          {/* Nickname (guardado en la tabla profiles con RLS) */}
          <div style={{
            marginTop: 14, padding: '12px 14px',
            background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--line-soft)',
          }}>
            <div className="label" style={{ marginBottom: 8 }}>Nickname</div>
            {nickDraft === null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13, color: nickname ? 'var(--fg)' : 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  {nickname ? `@${nickname}` : 'Sin nickname todavía'}
                </span>
                <button
                  onClick={() => { setNickDraft(nickname ?? ''); setNickErr(null) }}
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '5px 10px' }}
                >
                  {nickname ? 'Editar' : 'Elegir'}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    autoFocus
                    value={nickDraft}
                    maxLength={24}
                    onChange={e => setNickDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleNickSave(); if (e.key === 'Escape') { setNickDraft(null); setNickErr(null) } }}
                    placeholder="tu_nickname"
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    onClick={handleNickSave}
                    disabled={nickBusy || !NICKNAME_RE.test((nickDraft ?? '').trim())}
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '5px 12px' }}
                  >
                    {nickBusy ? '…' : 'Guardar'}
                  </button>
                </div>
                <div style={{ fontSize: 10.5, marginTop: 6, color: nickErr ? 'var(--danger)' : 'var(--muted)', lineHeight: 1.4 }}>
                  {nickErr ?? '3–24 caracteres: letras, números o guión bajo.'}
                </div>
              </div>
            )}
          </div>

          {/* Joined */}
          <div style={{
            marginTop: 20, padding: '12px 14px',
            background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--line-soft)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'color-mix(in oklch, var(--accent) 12%, var(--surface-2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 2 }}>Miembro desde</div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{joinedAt}</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--line-soft)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        }}>
          <div style={{
            padding: '14px 16px', background: 'var(--surface)',
            borderRadius: 'var(--radius)', border: '1px solid var(--line-soft)',
          }}>
            <div style={{ fontSize: 24, fontFamily: 'var(--display)', color: 'var(--accent)', lineHeight: 1 }}>
              {totalGarments}
            </div>
            <div className="label" style={{ marginTop: 6 }}>
              {totalGarments === 1 ? 'Prenda' : 'Prendas'}
            </div>
          </div>
          <div style={{
            padding: '14px 16px', background: 'var(--surface)',
            borderRadius: 'var(--radius)', border: '1px solid var(--line-soft)',
          }}>
            <div style={{ fontSize: 24, fontFamily: 'var(--display)', color: 'var(--fg)', lineHeight: 1 }}>
              {projects.filter(p => p.canvasJson).length}
            </div>
            <div className="label" style={{ marginTop: 6 }}>Guardados</div>
          </div>
        </div>

        {/* Selector de tema */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line-soft)' }}>
          <div className="label" style={{ marginBottom: 12 }}>Apariencia</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {THEMES.map(t => {
              const active = theme === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => onThemeChange(t.id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '12px 8px', cursor: 'pointer',
                    background: active ? 'color-mix(in oklch, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                    border: '1.5px solid ' + (active ? 'var(--accent)' : 'var(--line-soft)'),
                    borderRadius: 'var(--radius)',
                    transition: 'all 0.15s var(--ease)',
                  }}
                >
                  {/* mini preview de colores */}
                  <div style={{
                    display: 'flex', borderRadius: 6, overflow: 'hidden',
                    border: '1px solid var(--line-soft)', width: 44, height: 26,
                  }}>
                    <div style={{ flex: 1, background: t.swatch[0] }} />
                    <div style={{ flex: 1, background: t.swatch[1] }} />
                    <div style={{ width: 8, background: t.swatch[2] }} />
                  </div>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--ui)',
                    color: active ? 'var(--accent)' : 'var(--fg-2)',
                  }}>{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Grilla de proyectos */}
        {projects.length > 0 && (
          <div style={{ padding: '20px 24px', flex: 1 }}>
            <div className="label" style={{ marginBottom: 14 }}>Mis prendas</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
            }}>
              {projects.map(p => (
                <div key={p.id} style={{
                  aspectRatio: '1',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: 'var(--surface)',
                  border: '1px solid var(--line-soft)',
                  position: 'relative',
                }}>
                  {p.thumbnail ? (
                    <img
                      src={p.thumbnail}
                      alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 10,
                    }}>
                      <img
                        src={`/mockups/${p.mockupId}.svg`}
                        alt={p.name}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 3px 8px rgb(0 0 0 / 0.35))' }}
                      />
                    </div>
                  )}
                  {/* Nombre al hover */}
                  <div style={{
                    position: 'absolute', bottom: 0, insetInline: 0,
                    background: 'linear-gradient(transparent, rgb(0 0 0 / 0.7))',
                    padding: '10px 6px 5px',
                    fontSize: 9, color: 'white', fontFamily: 'var(--ui)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer: cerrar sesión */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line-soft)', marginTop: 'auto' }}>
          <button
            onClick={() => { onClose(); supabase.auth.signOut() }}
            className="btn"
            style={{
              width: '100%', justifyContent: 'center', gap: 8,
              color: 'var(--danger)', borderColor: 'color-mix(in oklch, var(--danger) 30%, var(--line))',
              fontSize: 13,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Cerrar sesión
          </button>
        </div>

      </div>
    </div>
  )
}
