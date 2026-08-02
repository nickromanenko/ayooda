'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, Code, Send } from 'lucide-react'
import { apiRequest } from '@/lib/api'

interface Channel {
  id: string
  type: string
  agentId?: string | null
  config: {
    agentName: string
    widgetColor: string
    widgetPosition: string
    welcomeMessage: string
  }
  embedCode: string
  isActive: boolean
  telegram?: {
    botUsername: string
    botId: string
  }
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [botToken, setBotToken] = useState('')
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [agentList, setAgentList] = useState<{ id: string; name: string; isDefault: boolean }[]>([])

  const fetchChannels = useCallback(() => {
    return apiRequest('/channels')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setChannels(data as Channel[]))
  }, [])

  useEffect(() => {
    fetchChannels().finally(() => setLoading(false))
    void apiRequest('/agents').then((res) => res.ok ? res.json() : { agents: [] }).then((d) => setAgentList(d.agents ?? []))
  }, [fetchChannels])

  async function assignAgent(channelId: string, agentId: string) {
    await apiRequest(`/channels/${channelId}/agent`, { method: 'PUT', body: JSON.stringify({ agentId }) })
    await fetchChannels()
  }

  function agentPicker(channel: Channel) {
    if (agentList.length < 2) return null
    return (
      <select
        value={channel.agentId ?? ''}
        onChange={(e) => void assignAgent(channel.id, e.target.value)}
        style={{ padding: '5px 8px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 12 }}
      >
        {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}
      </select>
    )
  }

  async function handleCopy(channelId: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(channelId)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleConnectTelegram() {
    setTelegramError(null)
    setTelegramBusy(true)
    try {
      const res = await apiRequest('/channels/telegram', {
        method: 'POST',
        body: JSON.stringify({ botToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTelegramError(data.error ?? 'Failed to connect Telegram bot.')
        return
      }
      setBotToken('')
      await fetchChannels()
    } catch {
      setTelegramError('Failed to connect Telegram bot.')
    } finally {
      setTelegramBusy(false)
    }
  }

  async function handleDisconnectTelegram() {
    setTelegramError(null)
    setTelegramBusy(true)
    try {
      const res = await apiRequest('/channels/telegram', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setTelegramError(data.error ?? 'Failed to disconnect Telegram bot.')
        return
      }
      await fetchChannels()
    } catch {
      setTelegramError('Failed to disconnect Telegram bot.')
    } finally {
      setTelegramBusy(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-mute)', padding: '48px 0', justifyContent: 'center' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} /> Loading…
      </div>
    )
  }

  const webWidget = channels.find((c) => c.type === 'web_widget')
  const telegramChannel = channels.find((c) => c.type === 'telegram')

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {agentPicker(webWidget)}
              <span style={{
                fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20,
                background: webWidget.isActive ? 'rgba(52,211,153,0.15)' : 'var(--panel-2)',
                color: webWidget.isActive ? 'var(--mint)' : 'var(--ink-mute)',
              }}>
                {webWidget.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
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

      {/* Telegram */}
      <div style={{ marginTop: 16, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Send size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Telegram</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                {telegramChannel ? `Connected as @${telegramChannel.telegram?.botUsername}` : 'Not connected'}
              </p>
            </div>
          </div>
          {telegramChannel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {agentPicker(telegramChannel)}
              <span style={{
                fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20,
                background: 'rgba(52,211,153,0.15)', color: 'var(--mint)',
              }}>
                Connected
              </span>
            </div>
          )}
        </div>

        <div style={{ padding: 20 }}>
          {telegramChannel ? (
            <div>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 16 }}>
                Your agent is live on Telegram as{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>
                  @{telegramChannel.telegram?.botUsername}
                </code>
                .
              </p>
              <button
                type="button"
                onClick={() => void handleDisconnectTelegram()}
                disabled={telegramBusy}
                style={{
                  fontSize: 12.5, fontWeight: 500, padding: '8px 16px', borderRadius: 'var(--r-sm)',
                  background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink-dim)',
                  cursor: telegramBusy ? 'default' : 'pointer', opacity: telegramBusy ? 0.6 : 1,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {telegramBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>
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
                  onClick={() => void handleConnectTelegram()}
                  disabled={telegramBusy || !botToken}
                  style={{
                    fontSize: 12.5, fontWeight: 500, padding: '8px 16px', borderRadius: 'var(--r-sm)',
                    background: 'var(--accent)', border: '1px solid var(--accent)', color: '#1a1200',
                    cursor: telegramBusy || !botToken ? 'default' : 'pointer', opacity: telegramBusy || !botToken ? 0.6 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {telegramBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                  Connect
                </button>
              </div>
              {telegramError && (
                <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12, marginTop: 10 }}>
                  {telegramError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Future channels */}
      <div style={{ marginTop: 16, background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 'var(--r-md)', padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)', margin: '0 0 4px' }}>More channels coming soon</p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>Email and Slack integrations are on the roadmap.</p>
      </div>
    </div>
  )
}
