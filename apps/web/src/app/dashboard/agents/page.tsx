'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Trash2, Star, FileText, BookOpen } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { LLM_MODELS, type AgentDoc } from '@ayooda/shared'
import AgentSkills from '@/components/dashboard/AgentSkills'

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

interface Editor { id: string; name: string; description: string; systemPrompt: string; llmModel: string; isDefault: boolean }

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [agentDocs, setAgentDocs] = useState<{ id: string; source: string; status: string }[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/agents')
      if (res.ok) { const d = await res.json() as { agents: AgentDoc[] }; setAgents(d.agents) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Load the editing agent's connected knowledge (keyed on id so it doesn't
  // refetch while typing in the editor fields).
  const editorId = editor?.id
  useEffect(() => {
    if (!editorId) { setAgentDocs([]); return }
    let cancelled = false
    setDocsLoading(true)
    apiRequest(`/agents/${editorId}/knowledge`)
      .then(async (res) => { if (res.ok && !cancelled) setAgentDocs(await res.json() as { id: string; source: string; status: string }[]) })
      .catch(() => { /* non-blocking */ })
      .finally(() => { if (!cancelled) setDocsLoading(false) })
    return () => { cancelled = true }
  }, [editorId])

  function edit(a: AgentDoc) {
    setEditor({ id: a.id, name: a.name, description: a.description, systemPrompt: a.systemPrompt, llmModel: a.llmModel, isDefault: a.isDefault })
    setError('')
  }

  async function create() {
    setCreating(true); setError('')
    try {
      const res = await apiRequest('/agents', { method: 'POST', body: JSON.stringify({ name: 'New agent' }) })
      const d = await res.json().catch(() => ({})) as AgentDoc & { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not create the agent'); return }
      await load(); edit(d)
    } finally { setCreating(false) }
  }

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    try {
      const res = await apiRequest(`/agents/${editor.id}`, { method: 'PUT', body: JSON.stringify({ name: editor.name.trim(), description: editor.description, systemPrompt: editor.systemPrompt, llmModel: editor.llmModel }) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the agent'); return }
      setEditor(null); await load()
    } finally { setSaving(false) }
  }

  async function makeDefault(id: string) {
    setBusyId(id)
    try { await apiRequest(`/agents/${id}/default`, { method: 'POST' }); await load() } finally { setBusyId('') }
  }

  async function remove(id: string) {
    setBusyId(id); setError('')
    try {
      const res = await apiRequest(`/agents/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; setError(d.error ?? 'Could not delete the agent'); return }
      await load()
    } finally { setBusyId('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Agents</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Each agent has its own persona, model, knowledge, and tools. Channels pick which agent answers.</p>
        </div>
        {!editor && <button type="button" onClick={() => void create()} disabled={creating} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px', flexShrink: 0, whiteSpace: 'nowrap' }}><Plus size={14} /> {creating ? 'Creating…' : 'New agent'}</button>}
      </div>

      {error && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{error}</p>}

      {!editor && (
        <div style={card}>
          <p style={label}>Your agents</p>
          {agents.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{a.name} {a.isDefault && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>· default</span>}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{a.llmModel}</p>
              </div>
              {!a.isDefault && <button type="button" onClick={() => void makeDefault(a.id)} disabled={busyId === a.id} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 'var(--r-sm)', padding: '6px 10px', fontSize: 12 }}><Star size={13} /> Set default</button>}
              <button type="button" onClick={() => edit(a)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              {!a.isDefault && <button type="button" onClick={() => void remove(a.id)} disabled={busyId === a.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>{busyId === a.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}</button>}
            </div>
          ))}
        </div>
      )}

      {editor && (
        <div style={card}>
          <p style={label}>Edit agent</p>
          <div style={{ marginBottom: 12 }}><input placeholder="Agent name" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} style={input} /></div>
          <div style={{ marginBottom: 12 }}><input placeholder="Short description" value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} style={input} /></div>
          <div style={{ marginBottom: 12 }}><textarea placeholder="System prompt — the agent's personality and instructions" value={editor.systemPrompt} onChange={(e) => setEditor({ ...editor, systemPrompt: e.target.value })} style={{ ...input, minHeight: 100, resize: 'vertical' }} /></div>

          <p style={{ ...label, marginTop: 16 }}>Model</p>
          <select value={editor.llmModel} onChange={(e) => setEditor({ ...editor, llmModel: e.target.value })} style={input}>
            {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.description}</option>)}
          </select>

          <p style={{ ...label, marginTop: 16 }}>Knowledge</p>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '12px 14px', background: 'var(--bg-2)' }}>
            {docsLoading ? (
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</p>
            ) : agentDocs.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0 }}>No knowledge connected to this agent yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agentDocs.map((k) => (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <FileText size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.source}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: k.status === 'indexed' ? 'var(--mint)' : k.status === 'error' ? '#f87171' : 'var(--accent)', flexShrink: 0 }}>{k.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Link href={`/dashboard/knowledge?agent=${editor.id}`} className="btn btn-ghost" style={{ marginTop: 12, borderRadius: 'var(--r-sm)', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={14} /> Manage knowledge
          </Link>

          <p style={{ ...label, marginTop: 16 }}>Skills</p>
          <AgentSkills agentId={editor.id} />

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save agent'}</button>
            <button type="button" onClick={() => setEditor(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
