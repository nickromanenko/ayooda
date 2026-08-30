'use client'

import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck, Compass, Headphones, Loader2, Sparkles, TrendingUp, Upload, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import {
  AGENT_ROLES,
  AGENT_TEMPLATES,
  DEFAULT_AGENT_ROLE_ID,
  MAX_AGENT_IMAGE_BYTES,
  validateAgentImage,
  type AgentTemplateId,
  type AgentDoc,
} from '@ayooda/shared'
import AgentAvatar from './AgentAvatar'
import { card, label, input } from './ui'
import styles from './NewAgentForm.module.css'

const TEMPLATE_ICONS = {
  'support-desk': Headphones,
  'sales-concierge': TrendingUp,
  'onboarding-guide': Compass,
  'knowledge-expert': BookOpenCheck,
} satisfies Record<AgentTemplateId, typeof Headphones>

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
  const [templateId, setTemplateId] = useState<AgentTemplateId | ''>('support-desk')
  const [role, setRole] = useState<string>(DEFAULT_AGENT_ROLE_ID)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const template = templateId ? AGENT_TEMPLATES.find((item) => item.id === templateId) : undefined

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
        body: JSON.stringify({
          name: trimmed,
          description: description.trim(),
          ...(templateId ? { templateId } : { role }),
        }),
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
      trackProductEvent('Agent Created', { role: template?.role ?? role, template_id: templateId || 'blank', has_logo: Boolean(file) })
      onCreated(agent, warning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the agent. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={card} className={styles.form}>
      <p style={label}>New agent</p>

      <div style={{ marginBottom: 20 }}>
        <p className={styles.intro}>
          Choose a proven starting point. Templates add editable instructions, safe workflows, built-in skills, and regression checks.
        </p>
        <div className={styles.templateGrid}>
          {AGENT_TEMPLATES.map((item) => {
            const selected = item.id === templateId
            const Icon = TEMPLATE_ICONS[item.id]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTemplateId(item.id)}
                aria-pressed={selected}
                autoFocus={item.id === 'support-desk'}
                className={styles.templateCard}
                data-selected={selected}
              >
                <span className={styles.templateIcon}><Icon size={17} /></span>
                <span className={styles.templateCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            )
          })}
          <button type="button" onClick={() => setTemplateId('')} aria-pressed={!templateId} className={styles.templateCard} data-selected={!templateId}>
            <span className={styles.templateIcon}><Sparkles size={17} /></span>
            <span className={styles.templateCopy}><strong>Blank agent</strong><small>Choose only a role and configure everything yourself.</small></span>
          </button>
        </div>
      </div>

      {template ? (
        <div className={styles.templateSummary} aria-live="polite">
          <div><strong>{template.label} includes</strong><span>Everything remains editable after creation.</span></div>
          <ul>{template.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
          <p>Knowledge, connections, channels, credentials, and deployment start empty.</p>
        </div>
      ) : (
        <div className={styles.roleSection}>
          <p className={styles.roleHeading}>What is this agent for? This sets only its starting instructions.</p>
          <div className={styles.roleGrid}>
            {AGENT_ROLES.map((item) => {
              const selected = item.id === role
              return (
                <button key={item.id} type="button" onClick={() => setRole(item.id)} aria-pressed={selected} className={styles.roleCard} data-selected={selected}>
                  <strong>{item.label}</strong><small>{item.description}</small>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
            placeholder={template ? `Agent name — e.g. ${template.suggestedName}` : 'Agent name — e.g. Amy'}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            style={input}
            placeholder={template?.suggestedDescription ?? 'Short description (optional)'}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>
        PNG, JPG or WebP up to {Math.round(MAX_AGENT_IMAGE_BYTES / (1024 * 1024))} MB. Model and knowledge are configured after creation.
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
