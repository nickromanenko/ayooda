'use client'

import { useState, useEffect, useCallback } from 'react'
import { Globe, Loader2, CheckCircle2, XCircle, Trash2, Plus, AlertCircle, FileText, RotateCw } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { KnowledgeUpload } from '@/components/knowledge/KnowledgeUpload'
import type { KnowledgeDocStatus } from '@ayooda/shared'

interface KnowledgeDoc {
  id: string
  type: string
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
}

const STATUS_CONFIG: Record<KnowledgeDocStatus, { icon: React.ReactNode; label: string; style: React.CSSProperties }> = {
  pending: {
    icon: <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />,
    label: 'Queued',
    style: { background: 'var(--panel-2)', color: 'var(--ink-mute)' },
  },
  processing: {
    icon: <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />,
    label: 'Indexing',
    style: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  },
  indexed: {
    icon: <CheckCircle2 size={12} />,
    label: 'Indexed',
    style: { background: 'rgba(52,211,153,0.15)', color: 'var(--mint)' },
  },
  error: {
    icon: <XCircle size={12} />,
    label: 'Error',
    style: { background: 'rgba(239,68,68,0.1)', color: '#f87171' },
  },
}

function hasActiveJobs(docs: KnowledgeDoc[]) {
  return docs.some((d) => d.status === 'pending' || d.status === 'processing')
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [urlInput, setUrlInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)
  const [agentList, setAgentList] = useState<{ id: string; name: string; isDefault: boolean }[]>([])
  const [agentId, setAgentId] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const res = await apiRequest('/agents')
      if (res.ok) {
        const d = await res.json() as { agents: { id: string; name: string; isDefault: boolean }[] }
        setAgentList(d.agents)
        // Pre-select the agent passed via ?agent=<id> (e.g. from the agent
        // editor's "Manage knowledge" link); else fall back to the default agent.
        const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('agent') : null
        const preselect = wanted && d.agents.some((a) => a.id === wanted) ? wanted : undefined
        setAgentId((prev) => prev || preselect || d.agents.find((a) => a.isDefault)?.id || d.agents[0]?.id || '')
      }
    })()
  }, [])

  const fetchDocs = useCallback(async () => {
    if (!agentId) return
    try {
      const res = await apiRequest(`/agents/${agentId}/knowledge`)
      if (!res.ok) return
      const data = (await res.json()) as KnowledgeDoc[]
      setDocs(data)
    } catch {
      // silently ignore polling errors
    }
  }, [agentId])

  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    fetchDocs().finally(() => setLoading(false))
  }, [fetchDocs, agentId])

  useEffect(() => {
    if (!hasActiveJobs(docs)) return
    const id = setInterval(fetchDocs, 4000)
    return () => clearInterval(id)
  }, [docs, fetchDocs])

  async function handleAdd() {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    try { new URL(trimmed) } catch {
      setUrlError('Please enter a valid URL including https://')
      return
    }
    setAdding(true)
    setUrlError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/knowledge/scrape`, {
        method: 'POST',
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error: string }
        throw new Error(data.error ?? 'Failed to add URL')
      }
      setUrlInput('')
      await fetchDocs()
    } catch (err: unknown) {
      setUrlError(err instanceof Error ? err.message : 'Failed to add URL')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await apiRequest(`/agents/${agentId}/knowledge/${id}`, { method: 'DELETE' })
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleReindex(id: string) {
    setReindexingId(id)
    try {
      await apiRequest(`/agents/${agentId}/knowledge/${id}/reindex`, { method: 'POST' })
      await fetchDocs()
    } finally {
      setReindexingId(null)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Knowledge base</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>
          Pages and documents your agent can reference when answering questions.
        </p>
      </div>

      {agentList.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-mute)', marginRight: 8 }}>Agent</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14 }}>
            {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </div>
      )}

      {/* Add URL */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }}>Add a website URL</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Globe size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-mute)', pointerEvents: 'none' }} />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setUrlError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
              placeholder="https://yourwebsite.com"
              style={{
                width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9,
                borderRadius: 'var(--r-sm)', border: `1px solid ${urlError ? '#f87171' : 'var(--line-2)'}`,
                background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14,
                outline: 'none', fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = urlError ? '#f87171' : 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = urlError ? '#f87171' : 'var(--line-2)')}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || !urlInput.trim()}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 'var(--r-sm)', opacity: adding || !urlInput.trim() ? 0.5 : 1, cursor: adding || !urlInput.trim() ? 'not-allowed' : 'pointer' }}
          >
            {adding ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {urlError && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f87171', marginTop: 8 }}>
            <AlertCircle size={12} /> {urlError}
          </p>
        )}
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8 }}>
          We'll crawl the page and its linked pages (up to 25 pages).
        </p>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <KnowledgeUpload uploadPath={`/agents/${agentId}/knowledge/upload`} onUploaded={() => void fetchDocs()} />
        </div>
      </div>

      {/* Doc list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '32px 0', justifyContent: 'center' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
          Loading…
        </div>
      ) : docs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--ink-mute)' }}>
          <Globe size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: 13, margin: 0 }}>No URLs added yet.</p>
          <p style={{ fontSize: 12, marginTop: 4, color: 'var(--ink-faint)' }}>Add your website above to get started.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {docs.map((doc, i) => {
            const cfg = STATUS_CONFIG[doc.status]
            return (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
                {doc.type === 'file' ? <FileText size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} /> : <Globe size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{doc.source}</p>
                  {doc.status === 'indexed' && (
                    <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{doc.chunkCount} chunks indexed</p>
                  )}
                  {doc.status === 'error' && doc.errorMessage && (
                    <p style={{ fontSize: 11, color: '#f87171', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.errorMessage}</p>
                  )}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, flexShrink: 0, ...cfg.style }}>
                  {cfg.icon} {cfg.label}
                </span>
                {(doc.status === 'indexed' || doc.status === 'error') && (
                  <button
                    type="button"
                    onClick={() => void handleReindex(doc.id)}
                    disabled={reindexingId === doc.id}
                    style={{ flexShrink: 0, padding: 6, borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', opacity: reindexingId === doc.id ? 0.4 : 1, transition: 'color .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-mute)')}
                    aria-label="Re-index"
                  >
                    {reindexingId === doc.id
                      ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      : <RotateCw size={14} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  style={{ flexShrink: 0, padding: 6, borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', opacity: deletingId === doc.id ? 0.4 : 1, transition: 'color .15s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-mute)')}
                  aria-label="Delete"
                >
                  {deletingId === doc.id
                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Trash2 size={14} />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
