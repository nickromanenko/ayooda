'use client'

import { useState } from 'react'
import { apiRequest } from '@/lib/api'
import { GEMINI_MODELS, type AgentTone } from '@ayooda/shared'

export interface IdentityData {
  name: string
  description: string
  tone: AgentTone
  systemPrompt: string
  llmModel: string
}

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
  if (description) parts.push(`You help with: ${description}`, "Always use the provided context to answer questions accurately. If you don't know the answer, say so honestly.")
  return parts.join('\n\n')
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)',
  background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14,
  outline: 'none', fontFamily: 'var(--font-sans)', transition: 'border-color .15s',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8,
}

export function StepIdentity({ onDone }: { onDone: (data: IdentityData) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tone, setTone] = useState<AgentTone>('friendly')
  const [llmModel, setLlmModel] = useState<string>(GEMINI_MODELS[0].id)
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>
          Set up your support agent
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 6 }}>
          Give your agent an identity. Visitors will see this in the chat widget.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '24px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
        {/* Name */}
        <div>
          <label htmlFor="agent-name" style={labelStyle}>
            Agent name <span style={{ color: 'var(--accent)' }}>*</span>
          </label>
          <input
            id="agent-name" type="text" required
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Aria, Max, Support Bot"
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" style={labelStyle}>What does it help with?</label>
          <textarea
            id="description" rows={2}
            value={description} onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Handles product questions, pricing, and onboarding for Acme SaaS"
            style={{ ...inputStyle, resize: 'none' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
          />
        </div>

        {/* Tone */}
        <div>
          <p style={labelStyle}>Tone</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {TONE_OPTIONS.map(t => (
              <button
                key={t.value} type="button" onClick={() => setTone(t.value)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  padding: '12px 14px', borderRadius: 'var(--r-sm)', textAlign: 'left',
                  cursor: 'pointer', transition: 'all .15s',
                  border: `1px solid ${tone === t.value ? 'var(--accent)' : 'var(--line)'}`,
                  background: tone === t.value ? 'var(--accent-soft)' : 'var(--bg-2)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.label}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div>
          <p style={labelStyle}>AI model</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {GEMINI_MODELS.map(m => (
              <button
                key={m.id} type="button" onClick={() => setLlmModel(m.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  padding: '12px 14px', borderRadius: 'var(--r-sm)', textAlign: 'left',
                  cursor: 'pointer', transition: 'all .15s',
                  border: `1px solid ${llmModel === m.id ? 'var(--accent)' : 'var(--line)'}`,
                  background: llmModel === m.id ? 'var(--accent-soft)' : 'var(--bg-2)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>Gemini {m.label}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{m.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        type="submit" disabled={loading || !name.trim()}
        className="btn btn-primary"
        style={{ justifyContent: 'center', opacity: loading || !name.trim() ? 0.5 : 1, borderRadius: 'var(--r-sm)', cursor: loading || !name.trim() ? 'not-allowed' : 'pointer' }}
      >
        {loading ? 'Saving…' : 'Continue →'}
      </button>
    </form>
  )
}
