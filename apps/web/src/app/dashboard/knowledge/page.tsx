'use client'

import { useState, useEffect, useCallback } from 'react'
import { Globe, Loader2, CheckCircle2, XCircle, Trash2, Plus, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import type { KnowledgeDocStatus } from '@ayooda/shared'

interface KnowledgeDoc {
  id: string
  type: string
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
}

const STATUS_CONFIG: Record<KnowledgeDocStatus, { icon: React.ReactNode; label: string; classes: string }> = {
  pending: {
    icon: <Loader2 size={13} className="animate-spin" />,
    label: 'Queued',
    classes: 'bg-zinc-100 text-zinc-500',
  },
  processing: {
    icon: <Loader2 size={13} className="animate-spin" />,
    label: 'Indexing',
    classes: 'bg-indigo-50 text-indigo-600',
  },
  indexed: {
    icon: <CheckCircle2 size={13} />,
    label: 'Indexed',
    classes: 'bg-emerald-50 text-emerald-600',
  },
  error: {
    icon: <XCircle size={13} />,
    label: 'Error',
    classes: 'bg-red-50 text-red-600',
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

  const fetchDocs = useCallback(async () => {
    try {
      const res = await apiRequest('/knowledge')
      if (!res.ok) return
      const data = (await res.json()) as KnowledgeDoc[]
      setDocs(data)
    } catch {
      // silently ignore polling errors
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchDocs().finally(() => setLoading(false))
  }, [fetchDocs])

  // Poll every 4s while any job is active
  useEffect(() => {
    if (!hasActiveJobs(docs)) return
    const id = setInterval(fetchDocs, 4000)
    return () => clearInterval(id)
  }, [docs, fetchDocs])

  async function handleAdd() {
    const trimmed = urlInput.trim()
    if (!trimmed) return

    try {
      new URL(trimmed)
    } catch {
      setUrlError('Please enter a valid URL including https://')
      return
    }

    setAdding(true)
    setUrlError('')
    try {
      const res = await apiRequest('/knowledge/scrape', {
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
      await apiRequest(`/knowledge/${id}`, { method: 'DELETE' })
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Knowledge base</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Pages your agent can reference when answering questions.
        </p>
      </div>

      {/* Add URL */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4 mb-6">
        <p className="text-sm font-medium text-zinc-700 mb-3">Add a website URL</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setUrlError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd() } }}
              placeholder="https://yourwebsite.com"
              className={cn(
                'w-full pl-8 pr-3 py-2 rounded-lg border text-sm text-zinc-900',
                'placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                urlError ? 'border-red-300' : 'border-zinc-300',
              )}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || !urlInput.trim()}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600',
              'hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {urlError && (
          <p className="flex items-center gap-1.5 text-xs text-red-500 mt-2">
            <AlertCircle size={12} /> {urlError}
          </p>
        )}
        <p className="text-xs text-zinc-400 mt-2">
          We&apos;ll crawl the page and its linked pages (up to 25 pages).
        </p>
      </div>

      {/* Doc list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <Globe size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No URLs added yet.</p>
          <p className="text-xs mt-1">Add your website above to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100">
          {docs.map((doc) => {
            const cfg = STATUS_CONFIG[doc.status]
            return (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-800 truncate">{doc.source}</p>
                  {doc.status === 'indexed' && (
                    <p className="text-xs text-zinc-400 mt-0.5">{doc.chunkCount} chunks indexed</p>
                  )}
                  {doc.status === 'error' && doc.errorMessage && (
                    <p className="text-xs text-red-500 mt-0.5 truncate">{doc.errorMessage}</p>
                  )}
                </div>
                <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0', cfg.classes)}>
                  {cfg.icon} {cfg.label}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="flex-shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                  aria-label="Delete"
                >
                  {deletingId === doc.id
                    ? <Loader2 size={14} className="animate-spin" />
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
