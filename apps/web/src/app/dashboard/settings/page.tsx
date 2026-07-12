'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check, Copy, LogOut } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { useAuth } from '@/components/providers/AuthProvider'

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
  const { signOut } = useAuth()

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [embedCode, setEmbedCode] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)
  const [savingWs, setSavingWs] = useState(false)
  const [savedWs, setSavedWs] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  const load = useCallback(async () => {
    try {
      const [userRes, wsRes, chRes] = await Promise.all([
        apiRequest('/user'),
        apiRequest('/workspace'),
        apiRequest('/channels'),
      ])
      if (!userRes.ok || !wsRes.ok) {
        setError('Failed to load settings')
        return
      }
      if (userRes.ok) {
        const u = await userRes.json() as { email: string; displayName: string }
        setEmail(u.email); setDisplayName(u.displayName)
      }
      if (wsRes.ok) {
        const w = await wsRes.json() as { name: string; hasOpenRouterKey?: boolean }
        setWorkspaceName(w.name)
        setHasKey(Boolean(w.hasOpenRouterKey))
      }
      if (chRes.ok) {
        const channels = await chRes.json() as Array<{ type: string; embedCode?: string }>
        const widget = channels.find((c) => c.type === 'web_widget')
        if (widget?.embedCode) setEmbedCode(widget.embedCode)
      }
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

  async function saveKey() {
    if (!keyInput.trim()) return
    setSavingKey(true); setError('')
    try {
      const res = await apiRequest('/workspace/key', { method: 'PUT', body: JSON.stringify({ apiKey: keyInput.trim() }) })
      if (!res.ok) throw new Error('Failed to save key')
      setHasKey(true); setKeyInput('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingKey(false) }
  }

  async function removeKey() {
    setSavingKey(true); setError('')
    try {
      await apiRequest('/workspace/key', { method: 'DELETE' })
      setHasKey(false)
    } finally { setSavingKey(false) }
  }

  function copyEmbed() {
    void navigator.clipboard.writeText(embedCode)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
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
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Manage your profile, workspace, and widget.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>
      )}

      {/* Profile */}
      <form onSubmit={(e) => void saveProfile(e)} style={cardStyle}>
        <p style={labelStyle}>Profile</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="displayName" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Display name</label>
            <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="email" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Email</label>
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
            <label htmlFor="wsName" style={{ ...labelStyle, textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, fontSize: 13 }}>Workspace name</label>
            <input id="wsName" type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} style={inputStyle} />
          </div>
          <div><SaveButton saving={savingWs} saved={savedWs} disabled={!workspaceName.trim()} /></div>
        </div>
      </form>

      {/* OpenRouter key */}
      <div style={cardStyle}>
        <p style={labelStyle}>OpenRouter API key</p>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 12px' }}>
          One key unlocks Claude, GPT, and more. Gemini works without a key on the platform&apos;s allowance.
        </p>
        {hasKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--mint)' }}><Check size={14} /> Connected</span>
            <button type="button" onClick={() => void removeKey()} disabled={savingKey} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, color: '#f87171' }}>Remove</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-or-..." style={{ ...inputStyle, flex: 1 }} />
            <button type="button" onClick={() => void saveKey()} disabled={savingKey || !keyInput.trim()} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: savingKey || !keyInput.trim() ? 0.5 : 1 }}>
              {savingKey ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Widget install */}
      <div style={cardStyle}>
        <p style={labelStyle}>Widget install</p>
        {embedCode ? (
          <>
            <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: 12, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', overflowX: 'auto', margin: '0 0 12px' }}>{embedCode}</pre>
            <button type="button" onClick={copyEmbed} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px' }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy snippet'}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>No widget yet. <a href="/dashboard/channels" style={{ color: 'var(--accent)' }}>Set one up →</a></p>
        )}
      </div>

      {/* Sign out */}
      <div style={cardStyle}>
        <p style={labelStyle}>Session</p>
        <button type="button" onClick={() => void signOut()} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', color: '#f87171' }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  )
}
