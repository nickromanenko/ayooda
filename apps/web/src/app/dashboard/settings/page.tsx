'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiRequest } from '@/lib/api'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
  background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14,
  outline: 'none', fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8,
}
const fieldLabelStyle: React.CSSProperties = {
  ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13,
}
const cardStyle: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20,
}

function SaveButton({ saving, saved, disabled }: { saving: boolean; saved: boolean; disabled?: boolean }) {
  return (
    <button type="submit" disabled={saving || disabled} className="btn btn-primary"
      style={{ justifyContent: 'center', borderRadius: 'var(--r-sm)', minWidth: 130,
        opacity: saving || disabled ? 0.5 : 1, cursor: saving || disabled ? 'not-allowed' : 'pointer',
        background: saved ? 'var(--mint)' : undefined, color: saved ? '#081a10' : undefined }}>
      {saving ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</span>
        : saved ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check size={14} /> Saved</span>
        : 'Save changes'}
    </button>
  )
}

export default function SettingsPage() {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)
  const [savingWs, setSavingWs] = useState(false)
  const [savedWs, setSavedWs] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [userRes, wsRes] = await Promise.all([apiRequest('/user'), apiRequest('/workspace')])
      if (!userRes.ok || !wsRes.ok) {
        setError('Failed to load settings')
        return
      }
      const u = await userRes.json() as { email: string; displayName: string }
      setEmail(u.email); setDisplayName(u.displayName)
      const w = await wsRes.json() as { name: string }
      setWorkspaceName(w.name)
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setSavingProfile(true); setSavedProfile(false); setError('')
    try {
      const res = await apiRequest('/user', { method: 'PUT', body: JSON.stringify({ displayName: displayName.trim() }) })
      if (!res.ok) throw new Error('Failed to save profile')
      setSavedProfile(true); setTimeout(() => setSavedProfile(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingProfile(false) }
  }

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceName.trim()) return
    setSavingWs(true); setSavedWs(false); setError('')
    try {
      const res = await apiRequest('/workspace', { method: 'PUT', body: JSON.stringify({ name: workspaceName.trim() }) })
      if (!res.ok) throw new Error('Failed to save workspace')
      setSavedWs(true); setTimeout(() => setSavedWs(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingWs(false) }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>
          Your profile and workspace. Anything that configures an agent lives on that agent.
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>
      )}

      {/* Profile */}
      <form onSubmit={(e) => void saveProfile(e)} style={cardStyle}>
        <p style={labelStyle}>Profile</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="displayName" style={fieldLabelStyle}>Display name</label>
            <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="email" style={fieldLabelStyle}>Email</label>
            <input id="email" type="email" value={email} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
          </div>
          <div><SaveButton saving={savingProfile} saved={savedProfile} disabled={!displayName.trim()} /></div>
        </div>
      </form>

      {/* Workspace */}
      <form onSubmit={(e) => void saveWorkspace(e)} style={cardStyle}>
        <p style={labelStyle}>Workspace</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="wsName" style={fieldLabelStyle}>Workspace name</label>
            <input id="wsName" type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} style={inputStyle} />
          </div>
          <div><SaveButton saving={savingWs} saved={savedWs} disabled={!workspaceName.trim()} /></div>
        </div>
      </form>
    </div>
  )
}
