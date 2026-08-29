'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import {
  AGENT_ROLES,
  DEFAULT_AGENT_ROLE_ID,
  MAX_AGENT_IMAGE_BYTES,
  validateAgentImage,
  type AgentDoc,
} from '@ayooda/shared'
import AgentAvatar from './AgentAvatar'
import { card, label, input } from './ui'

/**
 * Creates an agent only on submit. The chosen logo is held in memory and
 * uploaded after the agent exists, because the upload endpoint is keyed on the
 * agent id. A failed upload does not fail creation — the agent is already
 * usable and the logo can be set from the editor.
 */
export default function NewAgentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (agent: AgentDoc, warning?: string) => void
  onCancel: () => void
}) {
  const [role, setRole] = useState<string>(DEFAULT_AGENT_ROLE_ID)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function pickFile(f: File | null) {
    if (!f) return
    const v = validateAgentImage(f.name, f.size)
    if (!v.ok) { setError(v.error); return }
    setError('')
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(f))
  }

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Give your agent a name.'); return }

    setBusy(true); setError('')
    try {
      const res = await apiRequest('/agents', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, description: description.trim(), role }),
      })
      const agent = await res.json().catch(() => ({})) as AgentDoc & { error?: string }
      if (!res.ok) { setError(agent.error ?? 'Could not create the agent'); return }

      // Logo is a second leg: the endpoint needs the id we just got back.
      let warning: string | undefined
      if (file) {
        const form = new FormData()
        form.append('file', file)
        const up = await apiRequest(`/agents/${agent.id}/photo`, { method: 'POST', body: form })
        if (up.ok) {
          const d = await up.json().catch(() => ({})) as { photoURL?: string }
          if (d.photoURL) agent.photoURL = d.photoURL
        } else {
          const d = await up.json().catch(() => ({})) as { error?: string }
          warning = d.error ?? 'The agent was created, but the logo could not be uploaded.'
        }
      }
      if (preview) URL.revokeObjectURL(preview)
      trackProductEvent('Agent Created', { role, has_logo: Boolean(file) })
      onCreated(agent, warning)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={card}>
      <p style={label}>New agent</p>

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 10 }}>
          What is this agent for? This sets its starting instructions — you can edit them any time.
        </p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          {AGENT_ROLES.map((r) => {
            const selected = r.id === role
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                aria-pressed={selected}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 'var(--r-sm)',
                  border: `1px solid ${selected ? 'var(--control-primary)' : 'var(--line-2)'}`,
                  background: selected ? 'var(--control-selected)' : 'var(--control-surface)',
                  color: selected ? 'var(--control-selected-text)' : 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.4 }}>
                  {r.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <AgentAvatar name={name || 'A'} photoURL={preview} seed={name} size={64} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {!file && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12, cursor: 'pointer' }}
            >
              <Upload size={13} /> Logo
            </button>
          )}
          {file && (
            <button
              type="button"
              onClick={clearFile}
              disabled={busy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12, cursor: 'pointer' }}
            >
              <X size={13} /> Remove
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            style={input}
            placeholder="Agent name — e.g. Amy"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            style={input}
            placeholder="Short description (optional)"
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>
        PNG, JPG or WebP up to {Math.round(MAX_AGENT_IMAGE_BYTES / (1024 * 1024))} MB. Model, skills and
        knowledge are configured after creation.
      </p>

      {error && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 14 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {busy && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
          {busy ? 'Creating…' : 'Create agent'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
