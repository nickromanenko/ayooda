'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { Notice, PageHeader } from '@/components/dashboard/DashboardPrimitives'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
  background: 'var(--control-surface)', color: 'var(--ink)', fontSize: 14,
  fontFamily: 'var(--font-ui)', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8,
}
const fieldLabelStyle: React.CSSProperties = {
  ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-ui)', letterSpacing: 0, fontSize: 13,
}
const cardStyle: React.CSSProperties = {
  background: 'var(--panel)', border: 0, boxShadow: 'var(--shadow-soft)',
  borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20,
}

function SaveButton({ saving, saved, disabled }: { saving: boolean; saved: boolean; disabled?: boolean }) {
  return (
    <button type="submit" disabled={saving || disabled} className="btn btn-primary"
      style={{ justifyContent: 'center', borderRadius: 'var(--r-sm)', minWidth: 130,
        cursor: saving || disabled ? 'not-allowed' : 'pointer',
        background: saved ? 'var(--mint)' : undefined, color: saved ? '#081a10' : undefined }}>
      <span aria-live="polite">{saving ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</span>
        : saved ? <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check size={14} /> Saved</span>
        : 'Save changes'}</span>
    </button>
  )
}

export default function SettingsPage() {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [profileBaseline, setProfileBaseline] = useState('')
  const [workspaceBaseline, setWorkspaceBaseline] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)
  const [savingWs, setSavingWs] = useState(false)
  const [savedWs, setSavedWs] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setLoadFailed(false)
    try {
      const [userRes, wsRes] = await Promise.all([apiRequest('/user'), apiRequest('/workspace')])
      if (!userRes.ok || !wsRes.ok) {
        setError('Failed to load settings')
        setLoadFailed(true)
        return
      }
      const u = await userRes.json() as { email: string; displayName: string }
      setEmail(u.email); setDisplayName(u.displayName); setProfileBaseline(u.displayName)
      const w = await wsRes.json() as { name: string }
      setWorkspaceName(w.name); setWorkspaceBaseline(w.name)
    } catch {
      setError('Failed to load settings')
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const profileDirty = displayName.trim() !== profileBaseline
  const workspaceDirty = workspaceName.trim() !== workspaceBaseline

  useEffect(() => {
    if (!profileDirty && !workspaceDirty) return
    const message = 'You have unsaved changes. Leave this page and discard them?'
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const confirmDashboardNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.href === window.location.href || destination.origin !== window.location.origin) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', preventLeave)
    document.addEventListener('click', confirmDashboardNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', preventLeave)
      document.removeEventListener('click', confirmDashboardNavigation, true)
    }
  }, [profileDirty, workspaceDirty])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setSavingProfile(true); setSavedProfile(false); setError('')
    try {
      const res = await apiRequest('/user', { method: 'PUT', body: JSON.stringify({ displayName: displayName.trim() }) })
      if (!res.ok) throw new Error('Failed to save profile')
      setProfileBaseline(displayName.trim())
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
      setWorkspaceBaseline(workspaceName.trim())
      setSavedWs(true); setTimeout(() => setSavedWs(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingWs(false) }
  }

  if (loading) {
    return <Loading />
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <PageHeader title="Settings" description="Your profile and workspace. Anything that configures an agent lives on that agent." />

      {error && <Notice title={loadFailed ? 'Settings unavailable' : 'Could not save changes'} action={loadFailed ? <button type="button" className="btn btn-ghost" onClick={() => void load()}>Retry</button> : undefined}>{loadFailed ? 'We could not retrieve your saved profile and workspace values. Nothing has been overwritten.' : error}</Notice>}

      {/* Profile */}
      {!loadFailed && <form onSubmit={(e) => void saveProfile(e)} style={cardStyle}>
        <p style={labelStyle}>Profile</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="displayName" style={fieldLabelStyle}>Display name</label>
            <input id="displayName" className="dashboard-field" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="email" style={fieldLabelStyle}>Email</label>
            <input id="email" className="dashboard-field" type="email" value={email} disabled style={inputStyle} />
          </div>
          <div><SaveButton saving={savingProfile} saved={savedProfile} disabled={!displayName.trim() || !profileDirty} /></div>
        </div>
      </form>}

      {/* Workspace */}
      {!loadFailed && <form onSubmit={(e) => void saveWorkspace(e)} style={cardStyle}>
        <p style={labelStyle}>Workspace</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="wsName" style={fieldLabelStyle}>Workspace name</label>
            <input id="wsName" className="dashboard-field" type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} style={inputStyle} />
          </div>
          <div><SaveButton saving={savingWs} saved={savedWs} disabled={!workspaceName.trim() || !workspaceDirty} /></div>
        </div>
      </form>}
    </div>
  )
}
