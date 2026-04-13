'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { apiRequest } from '@/lib/api'
import { GEMINI_MODELS, type GeminiModelId, type AgentTone } from '@ayooda/shared'

export interface IdentityData {
  name: string
  description: string
  tone: AgentTone
  systemPrompt: string
  llmModel: GeminiModelId
}

const TONE_OPTIONS: { value: AgentTone; label: string; hint: string }[] = [
  { value: 'professional', label: 'Professional', hint: 'Formal and concise' },
  { value: 'friendly', label: 'Friendly', hint: 'Warm and helpful' },
  { value: 'casual', label: 'Casual', hint: 'Relaxed and conversational' },
]

function buildSystemPrompt(name: string, description: string, tone: AgentTone): string {
  const toneIntros: Record<AgentTone, string> = {
    professional:
      'You are a professional customer support agent. Respond clearly, accurately, and concisely.',
    friendly:
      'You are a friendly and approachable support agent. Be warm, empathetic, and helpful.',
    casual:
      "You are a casual, conversational support agent. Keep it relaxed and human — like chatting with a knowledgeable friend.",
  }
  const parts = [toneIntros[tone]]
  if (name) parts.push(`Your name is ${name}.`)
  if (description)
    parts.push(
      `You help with: ${description}`,
      'Always use the provided context to answer questions accurately. If you don\'t know the answer, say so honestly.',
    )
  return parts.join('\n\n')
}

export function StepIdentity({ onDone }: { onDone: (data: IdentityData) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tone, setTone] = useState<AgentTone>('friendly')
  const [llmModel, setLlmModel] = useState<GeminiModelId>(GEMINI_MODELS[0].id)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const systemPrompt = buildSystemPrompt(name, description, tone)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError('')
    try {
      const res = await apiRequest('/workspace/agent', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), description, systemPrompt, llmModel }),
      })
      if (!res.ok) throw new Error('Failed to save agent config')
      onDone({ name: name.trim(), description, tone, systemPrompt, llmModel })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Set up your support agent</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Give your agent an identity. Visitors will see this in the chat widget.
        </p>
      </div>

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
          className={cn(
            'w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900',
            'placeholder:text-zinc-400',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
          )}
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
          className={cn(
            'w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm text-zinc-900 resize-none',
            'placeholder:text-zinc-400',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
          )}
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
        disabled={loading || !name.trim()}
        className={cn(
          'w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white',
          'bg-indigo-600 hover:bg-indigo-700 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {loading ? 'Saving…' : 'Continue →'}
      </button>
    </form>
  )
}
