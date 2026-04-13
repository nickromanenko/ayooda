'use client'

import { useState, useEffect } from 'react'
import { Loader2, Copy, Check, Code } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'

interface Channel {
  id: string
  type: string
  config: {
    agentName: string
    widgetColor: string
    widgetPosition: string
    welcomeMessage: string
  }
  embedCode: string
  isActive: boolean
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    apiRequest('/channels')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setChannels(data as Channel[]))
      .finally(() => setLoading(false))
  }, [])

  async function handleCopy(channelId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(channelId)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-12 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  const webWidget = channels.find((c) => c.type === 'web_widget')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Channels</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage where your agent is deployed.</p>
      </div>

      {!webWidget ? (
        <div className="text-center py-16 text-zinc-400">
          <Code size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No channels yet. Complete onboarding to create your first widget.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          {/* Channel header */}
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Code size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">Web Widget</p>
                <p className="text-xs text-zinc-400">Agent: {webWidget.config.agentName}</p>
              </div>
            </div>
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              webWidget.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400',
            )}>
              {webWidget.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Embed code */}
          <div className="p-5">
            <p className="text-sm font-medium text-zinc-700 mb-3">Embed code</p>
            <p className="text-xs text-zinc-500 mb-3">
              Paste this into the{' '}
              <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-700 font-mono text-[11px]">&lt;head&gt;</code>
              {' '}or before{' '}
              <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-700 font-mono text-[11px]">&lt;/body&gt;</code>
              {' '}of every page on your website.
            </p>
            <div className="relative">
              <pre className="bg-zinc-900 text-zinc-100 text-xs font-mono rounded-xl p-4 pr-12 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {webWidget.embedCode}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopy(webWidget.id, webWidget.embedCode)}
                className={cn(
                  'absolute top-3 right-3 p-1.5 rounded-lg transition-colors',
                  copied === webWidget.id
                    ? 'bg-emerald-500 text-white'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600',
                )}
              >
                {copied === webWidget.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            {/* Install steps */}
            <div className="mt-5 bg-zinc-50 rounded-xl border border-zinc-200 p-4 space-y-2.5">
              <p className="text-xs font-medium text-zinc-700">How to install</p>
              {[
                'Copy the script tag above',
                'Paste it into your website\'s HTML — inside <head> or before </body>',
                'The widget will appear automatically on every page',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-xs text-zinc-600">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Future channels */}
      <div className="mt-4 bg-zinc-50 rounded-xl border border-zinc-200 border-dashed p-5">
        <p className="text-sm font-medium text-zinc-500 mb-1">More channels coming soon</p>
        <p className="text-xs text-zinc-400">Telegram, email, and Slack integrations are on the roadmap.</p>
      </div>
    </div>
  )
}
