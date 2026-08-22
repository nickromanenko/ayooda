'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, Code, Send, Plus } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { label, errorText } from '@/components/dashboard/ui'

interface Channel {
  id: string
  type: string
  embedCode?: string
  isActive: boolean
  telegram?: { botUsername: string; botId: number }
}

const panel: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 16,
}
const head: React.CSSProperties = {
  padding: '16px 20px', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
}
const icon: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20,
  background: on ? 'rgba(52,211,153,0.15)' : 'var(--panel-2)',
  color: on ? 'var(--mint)' : 'var(--ink-mute)', flexShrink: 0, whiteSpace: 'nowrap',
})

export default function AgentDeployPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const base = `/agents/${agentId}/channels`

  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [widgetBusy, setWidgetBusy] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [telegramError, setTelegramError] = useState('')
  const [telegramBusy, setTelegramBusy] = useState(false)

  const fetchChannels = useCallback(async () => {
    const res = await apiRequest(base)
    if (res.ok) setChannels(await res.json() as Channel[])
  }, [base])

  useEffect(() => {
    void fetchChannels().finally(() => setLoading(false))
  }, [fetchChannels])

  const widget = channels.find((c) => c.type === 'web_widget')
  const telegram = channels.find((c) => c.type === 'telegram')

  async function createWidget() {
    setWidgetBusy(true)
    try {
      await apiRequest(`${base}/web-widget`, { method: 'POST' })
      await fetchChannels()
    } finally { setWidgetBusy(false) }
  }

  async function removeWidget() {
    setWidgetBusy(true)
    try {
      await apiRequest(`${base}/web-widget`, { method: 'DELETE' })
      await fetchChannels()
    } finally { setWidgetBusy(false) }
  }

  async function copyEmbed(code: string) {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function connectTelegram() {
    setTelegramError(''); setTelegramBusy(true)
    try {
      const res = await apiRequest(`${base}/telegram`, { method: 'POST', body: JSON.stringify({ botToken }) })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setTelegramError(data.error ?? 'Failed to connect the Telegram bot.'); return }
      setBotToken('')
      await fetchChannels()
    } catch {
      setTelegramError('Failed to connect the Telegram bot.')
    } finally { setTelegramBusy(false) }
  }

  async function disconnectTelegram() {
    setTelegramError(''); setTelegramBusy(true)
    try {
      const res = await apiRequest(`${base}/telegram`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setTelegramError(data.error ?? 'Failed to disconnect the Telegram bot.')
        return
      }
      await fetchChannels()
    } catch {
      setTelegramError('Failed to disconnect the Telegram bot.')
    } finally { setTelegramBusy(false) }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Where this agent reaches people. Each agent gets its own widget and its own bot.
      </p>

      {/* Web widget */}
      <div style={panel}>
        <div style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={icon}><Code size={16} style={{ color: 'var(--accent)' }} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Website widget</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                {widget ? 'A floating chat bubble on your site' : 'Not created yet'}
              </p>
            </div>
          </div>
          <span style={pill(Boolean(widget?.isActive))}>{widget ? 'Live' : 'Off'}</span>
        </div>

        <div style={{ padding: 20 }}>
          {!widget ? (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 12 }}>
                Create a widget to get a script tag that puts this agent on your website.
              </p>
              <button type="button" onClick={() => void createWidget()} disabled={widgetBusy} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '9px 16px', fontSize: 13 }}>
                {widgetBusy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />} Create widget
              </button>
            </>
          ) : (
            <>
              <p style={label}>Embed code</p>
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
                }}>{widget.embedCode}</pre>
                <button
                  type="button"
                  onClick={() => void copyEmbed(widget.embedCode ?? '')}
                  aria-label="Copy embed code"
                  style={{
                    position: 'absolute', top: 10, right: 10,
                    padding: 6, borderRadius: 8, cursor: 'pointer',
                    background: copied ? 'var(--mint)' : 'var(--panel-2)',
                    border: '1px solid var(--line)',
                    color: copied ? '#081a10' : 'var(--ink-dim)',
                    display: 'flex', transition: 'all .15s',
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>

              <div style={{ marginTop: 20, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ ...label, marginBottom: 0 }}>How to install</p>
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

              <button type="button" onClick={() => void removeWidget()} disabled={widgetBusy} className="btn btn-ghost" style={{ marginTop: 16, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, color: '#f87171' }}>
                {widgetBusy ? 'Removing…' : 'Remove widget'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Telegram */}
      <div style={panel}>
        <div style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={icon}><Send size={16} style={{ color: 'var(--accent)' }} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Telegram</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                {telegram ? `Connected as @${telegram.telegram?.botUsername}` : 'Not connected'}
              </p>
            </div>
          </div>
          <span style={pill(Boolean(telegram))}>{telegram ? 'Live' : 'Off'}</span>
        </div>

        <div style={{ padding: 20 }}>
          {telegram ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 16 }}>
                This agent answers on{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>
                  @{telegram.telegram?.botUsername}
                </code>.
              </p>
              <button type="button" onClick={() => void disconnectTelegram()} disabled={telegramBusy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 16px', fontSize: 12.5 }}>
                {telegramBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 12 }}>
                Create a bot with @BotFather and paste its token here.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Bot token"
                  autoComplete="off"
                  style={{
                    flex: '1 1 220px', fontSize: 13, padding: '8px 12px', borderRadius: 'var(--r-sm)',
                    background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--ink)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void connectTelegram()}
                  disabled={telegramBusy || !botToken}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 16px', fontSize: 12.5, opacity: telegramBusy || !botToken ? 0.6 : 1 }}
                >
                  {telegramBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                  Connect
                </button>
              </div>
            </>
          )}
          {telegramError && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', ...errorText, marginTop: 10 }}>
              {telegramError}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 'var(--r-md)', padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)', margin: '0 0 4px' }}>More channels coming soon</p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>Email and Slack are on the roadmap.</p>
      </div>
    </>
  )
}
