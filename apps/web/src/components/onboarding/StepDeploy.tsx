'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import type { IdentityData } from './StepIdentity'

export function StepDeploy({
  identity,
  onDone,
}: {
  identity: IdentityData
  onDone: () => void
}) {
  const [embedCode, setEmbedCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function createChannel() {
      try {
        const res = await apiRequest('/channels/web-widget', { method: 'POST' })
        if (!res.ok) throw new Error('Failed to create widget channel')
        const data = (await res.json()) as { embedCode: string }
        setEmbedCode(data.embedCode)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    }
    createChannel()
  }, [])

  async function handleCopy() {
    if (!embedCode) return
    await navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {identity.name} is ready to deploy 🎉
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Paste this script tag into the <code className="text-zinc-700 font-mono text-xs bg-zinc-100 px-1 py-0.5 rounded">&lt;head&gt;</code> or before the closing{' '}
          <code className="text-zinc-700 font-mono text-xs bg-zinc-100 px-1 py-0.5 rounded">&lt;/body&gt;</code> tag of your website.
        </p>
      </div>

      {/* Embed code box */}
      {embedCode ? (
        <div className="relative">
          <pre className="bg-zinc-900 text-zinc-100 text-xs font-mono rounded-xl p-4 pr-12 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {embedCode}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'absolute top-3 right-3 p-1.5 rounded-lg transition-colors',
              copied
                ? 'bg-emerald-500 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600',
            )}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      ) : (
        <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
          <Loader2 size={16} className="animate-spin" />
          Generating your widget…
        </div>
      )}

      {/* Instructions */}
      {embedCode && (
        <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4 space-y-2.5">
          <p className="text-sm font-medium text-zinc-700">How to install</p>
          {[
            'Copy the script tag above',
            'Paste it into your website\'s HTML — inside <head> or before </body>',
            'The widget will appear automatically on every page',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-zinc-600">{step}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        disabled={!embedCode}
        className={cn(
          'w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white',
          'bg-indigo-600 hover:bg-indigo-700 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        Go to dashboard →
      </button>
    </div>
  )
}
