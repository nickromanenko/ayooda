'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Star, Trash2, MessagesSquare } from 'lucide-react'
import { LLM_MODELS, validateAgentImage, type AgentDoc } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import { card, label, input, muted, errorText } from '@/components/dashboard/ui'

export default function AgentInfoPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const router = useRouter()

  const [agent, setAgent] = useState<AgentDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await apiRequest(`/agents/${agentId}`)
    if (res.ok) setAgent(await res.json() as AgentDoc)
    else setError('Could not load this agent.')
    setLoading(false)
  }, [agentId])

  useEffect(() => { void load() }, [load])

  function patch(next: Partial<AgentDoc>) {
    setAgent((a) => (a ? { ...a, ...next } : a))
  }

  async function uploadLogo(file: File | null) {
    if (!file || !agent) return
    const v = validateAgentImage(file.name, file.size)
    if (!v.ok) { setError(v.error); return }
    setError(''); setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiRequest(`/agents/${agentId}/photo`, { method: 'POST', body: form })
      const d = await res.json().catch(() => ({})) as { photoURL?: string; error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not upload the logo'); return }
      patch({ photoURL: d.photoURL ?? null })
    } finally { setBusy(false) }
  }

  async function removeLogo() {
    setBusy(true)
    try {
      await apiRequest(`/agents/${agentId}/photo`, { method: 'DELETE' })
      patch({ photoURL: null })
    } finally { setBusy(false) }
  }

  async function save() {
    if (!agent) return
    setSaving(true); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: agent.name.trim(),
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          llmModel: agent.llmModel,
        }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the agent'); return }
      await load()
    } finally { setSaving(false) }
  }

  async function makeDefault() {
    setBusy(true)
    try { await apiRequest(`/agents/${agentId}/default`, { method: 'POST' }); await load() }
    finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Could not delete the agent')
        return
      }
      router.push('/dashboard/agents')
    } finally { setBusy(false) }
  }

  if (loading) {
    return <p style={{ ...muted, padding: '32px 0', textAlign: 'center' }}><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</p>
  }
  if (!agent) return <p style={errorText}>{error || 'Agent not found.'}</p>

  return (
    <>
      {error && <p style={{ ...errorText, marginBottom: 12 }}>{error}</p>}

      <div style={card}>
        <p style={label}>Identity</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <AgentAvatar name={agent.name} photoURL={agent.photoURL} seed={agent.id} size={56} />
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
              {agent.photoURL ? 'Replace logo' : 'Upload logo'}
              <input
                type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
                onChange={(e) => { void uploadLogo(e.target.files?.[0] ?? null); e.target.value = '' }}
              />
            </label>
            {agent.photoURL && (
              <button type="button" onClick={() => void removeLogo()} disabled={busy} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 12.5 }}>Remove</button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <input placeholder="Agent name" value={agent.name} onChange={(e) => patch({ name: e.target.value })} style={input} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input placeholder="Short description" value={agent.description} onChange={(e) => patch({ description: e.target.value })} style={input} />
        </div>
        <textarea
          placeholder="System prompt — the agent's personality and instructions"
          value={agent.systemPrompt}
          onChange={(e) => patch({ systemPrompt: e.target.value })}
          style={{ ...input, minHeight: 120, resize: 'vertical' }}
        />

        <p style={{ ...label, marginTop: 16 }}>Model</p>
        <select value={agent.llmModel} onChange={(e) => patch({ llmModel: e.target.value })} style={input}>
          {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.description}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void save()} disabled={saving || !agent.name.trim()} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: saving || !agent.name.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save agent'}
          </button>
          <Link href={`/dashboard/copilot?agent=${agent.id}`} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <MessagesSquare size={14} /> Test agent
          </Link>
        </div>
      </div>

      <div style={card}>
        <p style={label}>Manage</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!agent.isDefault && (
            <button type="button" onClick={() => void makeDefault()} disabled={busy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13 }}>
              <Star size={13} /> Make default
            </button>
          )}
          {!agent.isDefault && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, color: '#f87171' }}>
              {busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />} Delete agent
            </button>
          )}
          {agent.isDefault && (
            <p style={{ ...muted, margin: 0 }}>
              This is your default agent — new channels and the Copilot picker start here. Make another agent the default before deleting it.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
