'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CopyPlus, Loader2, Star, Trash2, MessagesSquare } from 'lucide-react'
import { validateAgentImage, type AgentDoc } from '@ayooda/shared'
import { apiRequestOrThrow } from '@/lib/api'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import { Loading } from '@/components/dashboard/Loading'
import ModelPicker from '@/components/dashboard/ModelPicker'
import AgentVersionHistory from './AgentVersionHistory'
import DuplicateAgentDialog from './DuplicateAgentDialog'
import { useWorkspace } from '@/hooks/useWorkspace'
import { card, label, input, muted, errorText } from '@/components/dashboard/ui'
import { useAppConfirm } from '@/components/ui/AppInteractionProvider'

export default function AgentInfoPage({ params }: { params: Promise<{ agentId: string }> }) {
  const confirm = useAppConfirm()
  const { agentId } = use(params)
  const router = useRouter()
  const { workspace } = useWorkspace()

  const [agent, setAgent] = useState<AgentDoc | null>(null)
  const [savedAgent, setSavedAgent] = useState<AgentDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await apiRequestOrThrow(`/agents/${agentId}`, {}, 'Could not load this agent.')
      const loaded = await res.json() as AgentDoc
      setAgent(loaded)
      setSavedAgent(loaded)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this agent.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const hasUnsavedChanges = Boolean(agent && savedAgent && (
    agent.name !== savedAgent.name
    || agent.description !== savedAgent.description
    || agent.systemPrompt !== savedAgent.systemPrompt
    || agent.llmModel !== savedAgent.llmModel
    || agent.role !== savedAgent.role
  ))

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])

  function patch(next: Partial<AgentDoc>) {
    setNotice('')
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
      const res = await apiRequestOrThrow(`/agents/${agentId}/photo`, { method: 'POST', body: form }, 'Could not upload the logo.')
      const d = await res.json().catch(() => ({})) as { photoURL?: string }
      patch({ photoURL: d.photoURL ?? null })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not upload the logo.') }
    finally { setBusy(false) }
  }

  async function removeLogo() {
    setBusy(true)
    try {
      await apiRequestOrThrow(`/agents/${agentId}/photo`, { method: 'DELETE' }, 'Could not remove the agent photo.')
      patch({ photoURL: null })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not remove the agent photo.') }
    finally { setBusy(false) }
  }

  async function save() {
    if (!agent) return
    setSaving(true); setError(''); setNotice('')
    try {
      await apiRequestOrThrow(`/agents/${agentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: agent.name.trim(),
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          llmModel: agent.llmModel,
        }),
      }, 'Could not save the agent.')
      await load()
      setHistoryRevision((value) => value + 1)
      setNotice('Agent saved.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the agent.') }
    finally { setSaving(false) }
  }

  async function makeDefault() {
    setBusy(true)
    try { await apiRequestOrThrow(`/agents/${agentId}/default`, { method: 'POST' }, 'Could not make this the default agent.'); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not make this the default agent.') }
    finally { setBusy(false) }
  }

  async function remove() {
    const name = agent?.name ?? 'this agent'
    if (!await confirm({ title: `Delete ${name}?`, description: 'Its configuration, knowledge connections, and deployment settings will be permanently removed. This cannot be undone.', confirmLabel: 'Delete agent' })) return
    setBusy(true); setError('')
    try {
      await apiRequestOrThrow(`/agents/${agentId}`, { method: 'DELETE' }, 'Could not delete the agent.')
      router.push('/dashboard/agents')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete the agent.') }
    finally { setBusy(false) }
  }

  if (loading) {
    return <Loading />
  }
  if (!agent) return (
    <div>
      <p role="alert" style={errorText}>{error || 'Agent not found.'}</p>
      {error && <button type="button" className="btn btn-ghost" onClick={() => void load()} style={{ marginTop: 12 }}>Retry</button>}
    </div>
  )

  return (
    <>
      {error && <p style={{ ...errorText, marginBottom: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ fontSize: 12.5, color: 'var(--success)', marginBottom: 12 }}>{notice}</p>}

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
        <ModelPicker agentId={agentId} value={agent.llmModel} onChange={(llmModel) => patch({ llmModel })} />

        <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void save()} disabled={saving || !agent.name.trim() || !hasUnsavedChanges} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: saving || !agent.name.trim() || !hasUnsavedChanges ? 0.6 : 1 }}>
            {saving ? 'Saving…' : hasUnsavedChanges ? 'Save agent' : 'Saved'}
          </button>
          <Link href={`/dashboard/agents/${agent.id}/test`} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <MessagesSquare size={14} /> Test agent
          </Link>
          <span role="status" style={{ marginLeft: 'auto', color: hasUnsavedChanges ? 'var(--accent-text)' : 'var(--ink-faint)', fontSize: 11.5 }}>
            {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
          </span>
        </div>
      </div>

      <AgentVersionHistory
        agentId={agentId}
        current={savedAgent ?? agent}
        refreshKey={historyRevision}
        onRestored={(restored) => {
          setAgent(restored)
          setSavedAgent(restored)
          setNotice('Configuration restored. Your previous settings were preserved as an undo point.')
          setHistoryRevision((value) => value + 1)
        }}
      />

      <div style={card}>
        <p style={label}>Manage</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {workspace?.role === 'owner' && (
            <button type="button" onClick={() => setDuplicateOpen(true)} disabled={busy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13 }}>
              <CopyPlus size={13} /> Duplicate agent
            </button>
          )}
          {!agent.isDefault && (
            <button type="button" onClick={() => void makeDefault()} disabled={busy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13 }}>
              <Star size={13} /> Make default
            </button>
          )}
          {!agent.isDefault && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, color: 'var(--danger)' }}>
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
      {duplicateOpen && <DuplicateAgentDialog source={savedAgent ?? agent} onClose={() => setDuplicateOpen(false)} />}
    </>
  )
}
