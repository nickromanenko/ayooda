'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { Globe, Loader2, CheckCircle2, XCircle, Trash2, Plus, AlertCircle, FileText, RotateCw } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { KnowledgeUpload } from '@/components/knowledge/KnowledgeUpload'
import { Loading, EmptyState } from '@/components/dashboard/Loading'
import type { KnowledgeDocStatus } from '@ayooda/shared'

interface KnowledgeDoc {
  id: string
  type: string
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
  autoSyncEnabled?: boolean
  syncIntervalHours?: 24 | 168 | 720 | null
  lastSyncedAt?: TimestampValue
  nextSyncAt?: TimestampValue
  syncError?: string | null
}

type TimestampValue = string | { _seconds?: number; seconds?: number } | null

const SYNC_INTERVAL_LABELS: Record<24 | 168 | 720, string> = {
  24: 'Daily',
  168: 'Weekly',
  720: 'Monthly',
}

function formatTimestamp(value: TimestampValue | undefined): string | null {
  if (!value) return null
  const date = typeof value === 'string'
    ? new Date(value)
    : new Date((value._seconds ?? value.seconds ?? 0) * 1000)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
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

export default function AgentKnowledgePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)

  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [urlInput, setUrlInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)
  const [savingSyncId, setSavingSyncId] = useState<string | null>(null)
  const [syncConfigError, setSyncConfigError] = useState('')

  const fetchDocs = useCallback(async () => {
    try {
      const res = await apiRequest(`/agents/${agentId}/knowledge`)
      if (!res.ok) return
      setDocs((await res.json()) as KnowledgeDoc[])
    } catch {
      // silently ignore polling errors
    }
  }, [agentId])

  useEffect(() => {
    setLoading(true)
    fetchDocs().finally(() => setLoading(false))
  }, [fetchDocs])

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

  async function handleSyncInterval(id: string, value: string) {
    setSavingSyncId(id)
    setSyncConfigError('')
    try {
      const intervalHours = value ? Number(value) : null
      const res = await apiRequest(`/agents/${agentId}/knowledge/${id}/sync`, {
        method: 'PATCH',
        body: JSON.stringify({ intervalHours }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to update automatic syncing')
      }
      await fetchDocs()
    } catch (err) {
      setSyncConfigError(err instanceof Error ? err.message : 'Failed to update automatic syncing')
    } finally {
      setSavingSyncId(null)
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Pages and documents this agent can reference when answering questions. Website sources can refresh automatically.
      </p>

      {syncConfigError && (
        <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f87171', margin: '-8px 0 14px' }}>
          <AlertCircle size={12} /> {syncConfigError}
        </p>
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
          We&apos;ll crawl the page and its linked pages (up to 25 pages).
        </p>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <KnowledgeUpload uploadPath={`/agents/${agentId}/knowledge/upload`} onUploaded={() => void fetchDocs()} />
        </div>
      </div>

      {/* Doc list */}
      {loading ? (
        <Loading pad="32px 0" />
      ) : docs.length === 0 ? (
        <EmptyState icon={<Globe size={32} />} title="No knowledge added yet." hint="Add your website above to get started." />
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
                  {doc.type === 'webpage' && doc.autoSyncEnabled && doc.syncIntervalHours && (
                    <p style={{ fontSize: 11, color: doc.syncError ? '#f87171' : 'var(--ink-mute)', marginTop: 2 }}>
                      Auto-sync {SYNC_INTERVAL_LABELS[doc.syncIntervalHours].toLowerCase()}
                      {formatTimestamp(doc.nextSyncAt) ? ` · Next ${formatTimestamp(doc.nextSyncAt)}` : ''}
                      {doc.syncError ? ` · Last attempt failed` : ''}
                    </p>
                  )}
                  {doc.type === 'webpage' && !doc.autoSyncEnabled && formatTimestamp(doc.lastSyncedAt) && (
                    <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                      Last synced {formatTimestamp(doc.lastSyncedAt)}
                    </p>
                  )}
                </div>
                {doc.type === 'webpage' && (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <select
                      aria-label={`Automatic sync interval for ${doc.source}`}
                      title="Automatic sync interval"
                      value={doc.autoSyncEnabled && doc.syncIntervalHours ? String(doc.syncIntervalHours) : ''}
                      disabled={savingSyncId === doc.id}
                      onChange={(e) => void handleSyncInterval(doc.id, e.target.value)}
                      style={{
                        minWidth: 92, padding: '5px 24px 5px 8px', borderRadius: 8,
                        border: '1px solid var(--line-2)', background: 'var(--bg-2)',
                        color: 'var(--ink-dim)', fontSize: 11, fontFamily: 'var(--font-mono)',
                        opacity: savingSyncId === doc.id ? 0.55 : 1,
                      }}
                    >
                      <option value="">Auto-sync off</option>
                      <option value="24">Daily</option>
                      <option value="168">Weekly</option>
                      <option value="720">Monthly</option>
                    </select>
                  </div>
                )}
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
                    aria-label={doc.type === 'webpage' ? 'Sync now' : 'Re-index'}
                    title={doc.type === 'webpage' ? 'Sync now' : 'Re-index'}
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
    </>
  )
}
