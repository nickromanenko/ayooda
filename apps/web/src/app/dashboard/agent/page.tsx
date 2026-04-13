'use client'

import { useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import { useWorkspace } from '@/hooks/useWorkspace'
import { GEMINI_MODELS, type GeminiModelId, type AgentTone } from '@ayooda/shared'

const TONE_OPTIONS: { value: AgentTone; label: string; hint: string }[] = [
  { value: 'professional', label: 'Professional', hint: 'Formal and concise' },
  { value: 'friendly', label: 'Friendly', hint: 'Warm and helpful' },
  { value: 'casual', label: 'Casual', hint: 'Relaxed and conversational' },
]

function buildSystemPrompt(name: string, description: string, tone: AgentTone): string {
  const toneIntros: Record<AgentTone, string> = {
    professional: 'You are a professional customer support agent. Respond clearly, accurately, and concisely.',
    friendly: 'You are a friendly and approachable support agent. Be warm, empathetic, and helpful.',
    casual: "You are a casual, conversational support agent. Keep it relaxed and human — like chatting with a knowledgeable friend.",
  }
  const parts = [toneIntros[tone]]
  if (name) parts.push(`Your name is ${name}.`)
  if (description) {
    parts.push(
      `You help with: ${description}`,
      "Always use the provided context to answer questions accurately. If you don't know the answer, say so honestly.",
    )
  }
  return parts.join('\n\n')
}

export default function AgentPage() {
  const { workspace, loading: wsLoading } = useWorkspace()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tone, setTone] = useState<AgentTone>('friendly')
  const [llmModel, setLlmModel] = useState<GeminiModelId>(GEMINI_MODELS[0].id)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Pre-populate from workspace
  useEffect(() => {
    if (!workspace) return
    setName(workspace.agent.name)
    setDescription(workspace.agent.description)
    setLlmModel(workspace.agent.llmModel)
    // Infer tone from system prompt (best-effort)
    const sp = workspace.agent.systemPrompt ?? ''
    if (sp.includes('professional')) setTone('professional')
    else if (sp.includes('casual')) setTone('casual')
    else setTone('friendly')
  }, [workspace])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const systemPrompt = buildSystemPrompt(name.trim(), description, tone)
      const res = await apiRequest('/workspace/agent', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), description, systemPrompt, llmModel }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (wsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-12 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Agent</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Configure your AI support agent's identity and model.</p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="bg-white rounded-xl border border-zinc-200 p-6 space-y-6">
        {/* Name */}
        <div>
          <label htmlFor="agent-name" className="block text-sm font-medium text-zinc-700 mb-1.5">
            Agent name <span className="text-red-500">*</span>
          </label>
          <input
            id="agent-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aria, Max, Support Bot"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-zinc-700 mb-1.5">
            What does it help with?
          </label>
          <textarea
            id="description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Handles product questions, pricing, and onboarding for Acme SaaS"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 resize-none placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Tone */}
        <div>
          <p className="text-sm font-medium text-zinc-700 mb-2">Tone</p>
          <div className="grid grid-cols-3 gap-2">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTone(t.value)}
                className={cn(
                  'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-colors',
                  tone === t.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50',
                )}
              >
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs opacity-70">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div>
          <p className="text-sm font-medium text-zinc-700 mb-2">AI model</p>
          <div className="grid grid-cols-2 gap-2">
            {GEMINI_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setLlmModel(m.id)}
                className={cn(
                  'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-colors',
                  llmModel === m.id
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50',
                )}
              >
                <span className="text-sm font-medium">Gemini {m.label}</span>
                <span className="text-xs opacity-70">{m.description}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className={cn(
            'w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            saved ? 'bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-700',
          )}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Saving…</span>
          ) : saved ? (
            <span className="flex items-center justify-center gap-2"><Check size={14} /> Saved</span>
          ) : (
            'Save changes'
          )}
        </button>
      </form>
    </div>
  )
}
