'use client'

import { useState, useEffect } from 'react'
import { Globe, Loader2, CheckCircle2, XCircle, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { KnowledgeUpload } from '@/components/knowledge/KnowledgeUpload'
import type { KnowledgeDocStatus } from '@ayooda/shared'

interface QueuedUrl {
  docId: string
  url: string
  status: KnowledgeDocStatus
}

const STATUS_COLOR: Record<KnowledgeDocStatus, string> = {
  pending: 'var(--ink-mute)',
  processing: 'var(--accent)',
  indexed: 'var(--mint)',
  error: '#f87171',
}

const STATUS_LABEL: Record<KnowledgeDocStatus, string> = {
  pending: 'Queued',
  processing: 'Indexing…',
  indexed: 'Indexed',
  error: 'Error',
}

function StatusIcon({ status }: { status: KnowledgeDocStatus }) {
  const color = STATUS_COLOR[status]
  if (status === 'indexed') return <CheckCircle2 size={13} style={{ color }} />
  if (status === 'error') return <XCircle size={13} style={{ color }} />
  return <Loader2 size={13} style={{ color, animation: 'spin 1s linear infinite' }} />
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px 10px 36px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
  background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14,
  outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color .15s',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8,
}

export function StepKnowledge({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [urlInput, setUrlInput] = useState('')
  const [queued, setQueued] = useState<QueuedUrl[]>([])
  const [adding, setAdding] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [agentId, setAgentId] = useState('')

  useEffect(() => {
    void (async () => {
      const res = await apiRequest('/agents')
      if (res.ok) {
        const d = await res.json() as { agents: { id: string; isDefault: boolean }[] }
        setAgentId(d.agents.find((a) => a.isDefault)?.id ?? d.agents[0]?.id ?? '')
      }
    })()
  }, [])

  async function handleAddUrl() {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    try { new URL(trimmed) } catch {
      setUrlError('Please enter a valid URL including https://')
      return
    }
    if (queued.some(q => q.url === trimmed)) { setUrlError('This URL has already been added'); return }
    setAdding(true)
    setUrlError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/knowledge/scrape`, { method: 'POST', body: JSON.stringify({ url: trimmed }) })
      if (!res.ok) throw new Error('Failed to queue URL')
      const data = (await res.json()) as { docId: string; status: KnowledgeDocStatus }
      setQueued(prev => [...prev, { docId: data.docId, url: trimmed, status: data.status }])
      setUrlInput('')
    } catch (err: unknown) {
      setUrlError(err instanceof Error ? err.message : 'Failed to add URL')
    } finally {
      setAdding(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void handleAddUrl() }
  }

  function removeUrl(docId: string) {
    setQueued(prev => prev.filter(q => q.docId !== docId))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>
          Add your knowledge base
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 6 }}>
          Enter your website URL or upload documents. We'll index the content so your agent can answer questions about it.
        </p>
      </div>

      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Website URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Globe size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-mute)', pointerEvents: 'none' }} />
              <input
                type="url" value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
                onKeyDown={handleKeyDown}
                placeholder="https://yourwebsite.com"
                style={{ ...inputStyle, borderColor: urlError ? '#f87171' : undefined }}
                onFocus={e => (e.currentTarget.style.borderColor = urlError ? '#f87171' : 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = urlError ? '#f87171' : 'var(--line-2)')}
              />
            </div>
            <button
              type="button" onClick={() => void handleAddUrl()}
              disabled={adding || !urlInput.trim()}
              className="btn btn-primary"
              style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: adding || !urlInput.trim() ? 0.5 : 1, cursor: adding || !urlInput.trim() ? 'not-allowed' : 'pointer' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
          {urlError && <p style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{urlError}</p>}
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 6 }}>
            We'll crawl the page and its linked pages automatically.
          </p>
        </div>

        <KnowledgeUpload
          uploadPath={`/agents/${agentId}/knowledge/upload`}
          onUploaded={(doc) =>
            setQueued((prev) => [...prev, { docId: doc.docId, url: doc.source, status: 'pending' }])
          }
        />

        {/* Queued URLs */}
        {queued.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queued.map(item => (
              <li key={item.docId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                <StatusIcon status={item.status} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.url}</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: STATUS_COLOR[item.status], flexShrink: 0 }}>{STATUS_LABEL[item.status]}</span>
                <button type="button" onClick={() => removeUrl(item.docId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2, display: 'flex' }}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button" onClick={onBack}
          className="btn btn-ghost"
          style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}
        >
          ← Back
        </button>
        <button
          type="button" onClick={onDone}
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r-sm)' }}
        >
          {queued.length > 0 ? 'Continue →' : 'Skip for now →'}
        </button>
      </div>
    </div>
  )
}
