'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import type { IdentityData } from './StepIdentity'

export function StepDeploy({ identity, onDone }: { identity: IdentityData; onDone: () => void }) {
  const [embedCode, setEmbedCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function createChannel() {
      try {
        // Channels belong to an agent, so resolve the workspace's default agent
        // (created during sign-up) before asking for its widget.
        const agentsRes = await apiRequest('/agents')
        if (!agentsRes.ok) throw new Error('Failed to load your agent')
        const { agents } = (await agentsRes.json()) as { agents: { id: string; isDefault: boolean }[] }
        const agentId = agents.find((a) => a.isDefault)?.id ?? agents[0]?.id
        if (!agentId) throw new Error('No agent to deploy yet')

        const res = await apiRequest(`/agents/${agentId}/channels/web-widget`, { method: 'POST' })
        if (!res.ok) throw new Error('Failed to create widget channel')
        const data = (await res.json()) as { embedCode: string }
        setEmbedCode(data.embedCode)
        trackProductEvent('Channel Connected', { channel_type: 'web_widget', context: 'onboarding' })
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>
          {identity.name} is ready to deploy
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 6 }}>
          Paste this script tag into the{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>&lt;head&gt;</code>
          {' '}or before the closing{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>&lt;/body&gt;</code>
          {' '}tag of your website.
        </p>
      </div>

      {/* Embed code */}
      {embedCode ? (
        <div style={{ position: 'relative' }}>
          <pre style={{
            background: 'var(--bg)', color: 'var(--ink-dim)',
            fontFamily: 'var(--font-mono)', fontSize: 12.5,
            borderRadius: 'var(--r-md)', padding: '16px 48px 16px 16px',
            border: '1px solid var(--line-2)',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            lineHeight: 1.6, margin: 0,
          }}>
            {embedCode}
          </pre>
          <button
            type="button" onClick={() => void handleCopy()}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 40, height: 40, padding: 0, borderRadius: 8, cursor: 'pointer',
              background: copied ? 'var(--mint)' : 'var(--panel-2)',
              border: '1px solid var(--line)',
              color: copied ? '#081a10' : 'var(--ink-dim)',
              display: 'grid', placeItems: 'center', transition: 'background-color .15s, color .15s',
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      ) : error ? (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink-mute)', padding: '16px 0' }}>
          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
          Generating your widget…
        </div>
      )}

      {/* Install steps */}
      {embedCode && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', margin: 0 }}>How to install</p>
          {[
            'Copy the script tag above',
            "Paste it into your website's HTML — inside <head> or before </body>",
            'The widget will appear automatically on every page',
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: 50,
                background: 'var(--accent-soft)', border: '1px solid rgba(245,165,36,0.25)',
                color: 'var(--accent)', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
              }}>{i + 1}</span>
              <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.5 }}>{s}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button" onClick={onDone} disabled={!embedCode}
        className="btn btn-primary"
        style={{ justifyContent: 'center', borderRadius: 'var(--r-sm)', opacity: !embedCode ? 0.5 : 1, cursor: !embedCode ? 'not-allowed' : 'pointer' }}
      >
        Go to dashboard →
      </button>
    </div>
  )
}
