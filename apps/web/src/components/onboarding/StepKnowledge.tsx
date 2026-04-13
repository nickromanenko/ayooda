'use client'

import { useState } from 'react'
import { Globe, Loader2, CheckCircle2, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import type { KnowledgeDocStatus } from '@ayooda/shared'

interface QueuedUrl {
  docId: string
  url: string
  status: KnowledgeDocStatus
}

const STATUS_ICON: Record<KnowledgeDocStatus, React.ReactNode> = {
  pending: <Loader2 size={14} className="text-zinc-400 animate-spin" />,
  processing: <Loader2 size={14} className="text-indigo-500 animate-spin" />,
  indexed: <CheckCircle2 size={14} className="text-emerald-500" />,
  error: <XCircle size={14} className="text-red-400" />,
}

const STATUS_LABEL: Record<KnowledgeDocStatus, string> = {
  pending: 'Queued',
  processing: 'Indexing…',
  indexed: 'Indexed',
  error: 'Error',
}

export function StepKnowledge({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack: () => void
}) {
  const [urlInput, setUrlInput] = useState('')
  const [queued, setQueued] = useState<QueuedUrl[]>([])
  const [adding, setAdding] = useState(false)
  const [urlError, setUrlError] = useState('')

  async function handleAddUrl() {
    const trimmed = urlInput.trim()
    if (!trimmed) return

    try {
      new URL(trimmed) // validate
    } catch {
      setUrlError('Please enter a valid URL including https://')
      return
    }

    if (queued.some((q) => q.url === trimmed)) {
      setUrlError('This URL has already been added')
      return
    }

    setAdding(true)
    setUrlError('')
    try {
      const res = await apiRequest('/knowledge/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) throw new Error('Failed to queue URL')
      const data = (await res.json()) as { docId: string; status: KnowledgeDocStatus }
      setQueued((prev) => [...prev, { docId: data.docId, url: trimmed, status: data.status }])
      setUrlInput('')
    } catch (err: unknown) {
      setUrlError(err instanceof Error ? err.message : 'Failed to add URL')
    } finally {
      setAdding(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddUrl()
    }
  }

  function removeUrl(docId: string) {
    setQueued((prev) => prev.filter((q) => q.docId !== docId))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Add your knowledge base</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Enter your website URL. We'll crawl and index the content so your agent can answer
          questions about it.
        </p>
      </div>

      {/* URL input */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1.5">Website URL</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Globe
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
            />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value)
                setUrlError('')
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://yourwebsite.com"
              className={cn(
                'w-full pl-9 pr-3 py-2 rounded-lg border text-sm text-zinc-900',
                'placeholder:text-zinc-400',
                'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
                urlError ? 'border-red-300' : 'border-zinc-300',
              )}
            />
          </div>
          <button
            type="button"
            onClick={handleAddUrl}
            disabled={adding || !urlInput.trim()}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600',
              'hover:bg-indigo-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {urlError && <p className="text-xs text-red-500 mt-1.5">{urlError}</p>}
        <p className="text-xs text-zinc-400 mt-1.5">
          We'll crawl the page and its linked pages automatically.
        </p>
      </div>

      {/* Queued URLs */}
      {queued.length > 0 && (
        <ul className="space-y-2">
          {queued.map((item) => (
            <li
              key={item.docId}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-50 border border-zinc-200"
            >
              {STATUS_ICON[item.status]}
              <span className="flex-1 text-sm text-zinc-700 truncate">{item.url}</span>
              <span className="text-xs text-zinc-400 flex-shrink-0">{STATUS_LABEL[item.status]}</span>
              <button
                type="button"
                onClick={() => removeUrl(item.docId)}
                className="text-zinc-400 hover:text-zinc-600 flex-shrink-0"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onDone}
          className={cn(
            'flex-1 py-2.5 px-4 rounded-lg text-sm font-medium text-white',
            'bg-indigo-600 hover:bg-indigo-700 transition-colors',
          )}
        >
          {queued.length > 0 ? 'Continue →' : 'Skip for now →'}
        </button>
      </div>
    </div>
  )
}
