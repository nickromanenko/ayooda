'use client'

import { useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { useWorkspace } from '@/hooks/useWorkspace'
import { LLM_MODELS, providerOf, type LLMProvider, type AgentTone } from '@ayooda/shared'

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

export default function AgentPage() {
  const { workspace, loading: wsLoading } = useWorkspace()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tone, setTone] = useState<AgentTone>('friendly')
  const [llmModel, setLlmModel] = useState<string>(LLM_MODELS[0].id)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!workspace) return
    setName(workspace.agent.name)
    setDescription(workspace.agent.description)
    setLlmModel(workspace.agent.llmModel)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Agent</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Configure your AI support agent's identity and model.</p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Name */}
        <div>
          <label htmlFor="agent-name" style={labelStyle}>
            Agent name <span style={{ color: 'var(--accent)' }}>*</span>
          </label>
          <input
            id="agent-name" type="text" required
            value={name} onChange={(e) => setName(e.target.value)}
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
            value={description} onChange={(e) => setDescription(e.target.value)}
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
            {TONE_OPTIONS.map((t) => (
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
                <span style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div>
          <p style={labelStyle}>AI model</p>
          {(['gemini', 'claude', 'openai'] as LLMProvider[]).map((prov) => (
            <div key={prov} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', textTransform: 'capitalize', margin: '0 0 6px' }}>{prov}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {LLM_MODELS.filter((m) => m.provider === prov).map((m) => (
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
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{m.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {providerOf(llmModel) !== 'gemini' && workspace && !workspace.hasOpenRouterKey && (
            <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
              This model needs an OpenRouter key. <a href="/dashboard/settings" style={{ color: 'var(--accent)' }}>Add one in Settings →</a>
            </p>
          )}
        </div>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn btn-primary"
          style={{
            justifyContent: 'center', borderRadius: 'var(--r-sm)',
            opacity: saving || !name.trim() ? 0.5 : 1,
            cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
            background: saved ? 'var(--mint)' : undefined,
            color: saved ? '#081a10' : undefined,
          }}
        >
          {saving ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</span>
          ) : saved ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check size={14} /> Saved</span>
          ) : (
            'Save changes'
          )}
        </button>
      </form>
    </div>
  )
}
