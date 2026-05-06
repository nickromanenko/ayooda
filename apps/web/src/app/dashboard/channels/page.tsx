'use client'

import { useState, useEffect } from 'react'
import { Loader2, Copy, Check, Code } from 'lucide-react'
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  const webWidget = channels.find((c) => c.type === 'web_widget')

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Channels</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Manage where your agent is deployed.</p>
      </div>

      {!webWidget ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--ink-mute)' }}>
          <Code size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: 13, margin: 0 }}>No channels yet. Complete onboarding to create your first widget.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {/* Channel header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Code size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Web Widget</p>
                <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>Agent: {webWidget.config.agentName}</p>
              </div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20,
              background: webWidget.isActive ? 'rgba(52,211,153,0.15)' : 'var(--panel-2)',
              color: webWidget.isActive ? 'var(--mint)' : 'var(--ink-mute)',
            }}>
              {webWidget.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Embed code */}
          <div style={{ padding: 20 }}>
            <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }}>Embed code</p>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
              Paste this into the{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>&lt;head&gt;</code>
              {' '}or before{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>&lt;/body&gt;</code>
              {' '}of every page on your website.
            </p>
            <div style={{ position: 'relative' }}>
              <pre style={{
                background: 'var(--bg)', color: 'var(--ink-dim)',
                fontFamily: 'var(--font-mono)', fontSize: 12,
                borderRadius: 'var(--r-sm)', padding: '14px 48px 14px 14px',
                border: '1px solid var(--line-2)',
                overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                lineHeight: 1.6, margin: 0,
              }}>
                {webWidget.embedCode}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopy(webWidget.id, webWidget.embedCode)}
                style={{
                  position: 'absolute', top: 10, right: 10,
                  padding: 6, borderRadius: 8, cursor: 'pointer',
                  background: copied === webWidget.id ? 'var(--mint)' : 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  color: copied === webWidget.id ? '#081a10' : 'var(--ink-dim)',
                  display: 'flex', transition: 'all .15s',
                }}
              >
                {copied === webWidget.id ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>

            {/* Install steps */}
            <div style={{ marginTop: 20, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', margin: 0 }}>How to install</p>
              {[
                'Copy the script tag above',
                "Paste it into your website's HTML — inside <head> or before </body>",
                'The widget will appear automatically on every page',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    flexShrink: 0, width: 20, height: 20, borderRadius: 50,
                    background: 'var(--accent-soft)', border: '1px solid rgba(245,165,36,0.25)',
                    color: 'var(--accent)', fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)',
                  }}>{i + 1}</span>
                  <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.5 }}>{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Future channels */}
      <div style={{ marginTop: 16, background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 'var(--r-md)', padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)', margin: '0 0 4px' }}>More channels coming soon</p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>Telegram, email, and Slack integrations are on the roadmap.</p>
      </div>
    </div>
  )
}
