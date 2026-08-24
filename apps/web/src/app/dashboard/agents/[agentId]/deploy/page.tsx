'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, Code, Send, Plus, Mail, Slack as SlackIcon, ExternalLink, Smartphone } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import { Loading } from '@/components/dashboard/Loading'
import { label, errorText, input } from '@/components/dashboard/ui'
import WidgetAppearance from '@/components/dashboard/WidgetAppearance'
import {
  DEFAULT_WIDGET_COLOR,
  DEFAULT_WIDGET_POSITION,
  type WidgetAppearance as Appearance,
} from '@ayooda/shared'

interface Channel {
  id: string
  type: string
  embedCode?: string
  isActive: boolean
  brandingLocked?: boolean
  config?: Partial<Appearance> & { agentName?: string; fromAddress?: string; inboxAddress?: string; accountSid?: string; fromNumber?: string }
  telegram?: { botUsername: string; botId: number }
  slack?: { teamId: string; teamName: string; botUserId: string }
  twilio?: { accountSid: string; fromNumber: string }
  webhookUrl?: string
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
  const [emailForm, setEmailForm] = useState({ resendApiKey: '', fromAddress: '', inboxAddress: '', webhookSecret: '' })
  const [emailError, setEmailError] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailWebhookUrl, setEmailWebhookUrl] = useState('')
  const [slackForm, setSlackForm] = useState({ botToken: '', signingSecret: '' })
  const [slackError, setSlackError] = useState('')
  const [slackBusy, setSlackBusy] = useState(false)
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('')
  const [slackCopied, setSlackCopied] = useState(false)
  const [smsForm, setSmsForm] = useState({ accountSid: '', authToken: '', fromNumber: '' })
  const [smsError, setSmsError] = useState('')
  const [smsBusy, setSmsBusy] = useState(false)
  const [smsWebhookUrl, setSmsWebhookUrl] = useState('')
  const [smsCopied, setSmsCopied] = useState(false)

  const fetchChannels = useCallback(async () => {
    const res = await apiRequest(base)
    if (res.ok) setChannels(await res.json() as Channel[])
  }, [base])

  useEffect(() => {
    void fetchChannels().finally(() => setLoading(false))
  }, [fetchChannels])

  const widget = channels.find((c) => c.type === 'web_widget')
  const telegram = channels.find((c) => c.type === 'telegram')
  const email = channels.find((c) => c.type === 'email')
  const slack = channels.find((c) => c.type === 'slack')
  const sms = channels.find((c) => c.type === 'sms')

  async function createWidget() {
    setWidgetBusy(true)
    try {
      const res = await apiRequest(`${base}/web-widget`, { method: 'POST' })
      if (res.ok) trackProductEvent('Channel Connected', { channel_type: 'web_widget', context: 'dashboard' })
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

  function applyAppearance(next: Appearance) {
    setChannels((prev) => prev.map((c) => (
      c.type === 'web_widget' ? { ...c, config: { ...c.config, ...next } } : c
    )))
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
      trackProductEvent('Channel Connected', { channel_type: 'telegram', context: 'dashboard' })
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

  async function connectEmail() {
    setEmailError(''); setEmailBusy(true); setEmailWebhookUrl('')
    try {
      const res = await apiRequest(`${base}/email`, { method: 'POST', body: JSON.stringify(emailForm) })
      const data = await res.json().catch(() => ({})) as { error?: string; webhookUrl?: string }
      if (!res.ok) { setEmailError(data.error ?? 'Failed to connect email.'); return }
      setEmailWebhookUrl(data.webhookUrl ?? '')
      setEmailForm({ resendApiKey: '', fromAddress: '', inboxAddress: '', webhookSecret: '' })
      trackProductEvent('Channel Connected', { channel_type: 'email', context: 'dashboard' })
      await fetchChannels()
    } catch {
      setEmailError('Failed to connect email.')
    } finally { setEmailBusy(false) }
  }

  async function disconnectEmail() {
    setEmailError(''); setEmailBusy(true); setEmailWebhookUrl('')
    try {
      const res = await apiRequest(`${base}/email`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setEmailError(data.error ?? 'Failed to disconnect email.')
        return
      }
      await fetchChannels()
    } catch {
      setEmailError('Failed to disconnect email.')
    } finally { setEmailBusy(false) }
  }

  async function connectSlack() {
    setSlackError(''); setSlackBusy(true); setSlackWebhookUrl('')
    try {
      const res = await apiRequest(`${base}/slack`, { method: 'POST', body: JSON.stringify(slackForm) })
      const data = await res.json().catch(() => ({})) as { error?: string; webhookUrl?: string }
      if (!res.ok) { setSlackError(data.error ?? 'Failed to connect Slack.'); return }
      setSlackWebhookUrl(data.webhookUrl ?? '')
      setSlackForm({ botToken: '', signingSecret: '' })
      trackProductEvent('Channel Connected', { channel_type: 'slack', context: 'dashboard' })
      await fetchChannels()
    } catch {
      setSlackError('Failed to connect Slack.')
    } finally { setSlackBusy(false) }
  }

  async function disconnectSlack() {
    setSlackError(''); setSlackBusy(true); setSlackWebhookUrl(''); setSlackCopied(false)
    try {
      const res = await apiRequest(`${base}/slack`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setSlackError(data.error ?? 'Failed to disconnect Slack.')
        return
      }
      await fetchChannels()
    } catch {
      setSlackError('Failed to disconnect Slack.')
    } finally { setSlackBusy(false) }
  }

  async function copySlackWebhook(url: string) {
    await navigator.clipboard.writeText(url)
    setSlackCopied(true)
    setTimeout(() => setSlackCopied(false), 2_000)
  }

  async function connectSms() {
    setSmsError(''); setSmsBusy(true); setSmsWebhookUrl('')
    try {
      const res = await apiRequest(`${base}/sms`, { method: 'POST', body: JSON.stringify(smsForm) })
      const data = await res.json().catch(() => ({})) as { error?: string; webhookUrl?: string }
      if (!res.ok) { setSmsError(data.error ?? 'Failed to connect Twilio SMS.'); return }
      setSmsWebhookUrl(data.webhookUrl ?? '')
      setSmsForm({ accountSid: '', authToken: '', fromNumber: '' })
      trackProductEvent('Channel Connected', { channel_type: 'sms', context: 'dashboard' })
      await fetchChannels()
    } catch {
      setSmsError('Failed to connect Twilio SMS.')
    } finally { setSmsBusy(false) }
  }

  async function disconnectSms() {
    setSmsError(''); setSmsBusy(true); setSmsWebhookUrl(''); setSmsCopied(false)
    try {
      const res = await apiRequest(`${base}/sms`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setSmsError(data.error ?? 'Failed to disconnect Twilio SMS.')
        return
      }
      await fetchChannels()
    } catch {
      setSmsError('Failed to disconnect Twilio SMS.')
    } finally { setSmsBusy(false) }
  }

  async function copySmsWebhook(url: string) {
    await navigator.clipboard.writeText(url)
    setSmsCopied(true)
    setTimeout(() => setSmsCopied(false), 2_000)
  }

  if (loading) {
    return <Loading />
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Where this agent reaches people. Each connection keeps its own identity, credentials, and conversation history.
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

              <WidgetAppearance
                agentId={agentId}
                agentName={widget.config?.agentName ?? 'Support Agent'}
                brandingLocked={widget.brandingLocked !== false}
                initial={{
                  widgetColor: widget.config?.widgetColor ?? DEFAULT_WIDGET_COLOR,
                  widgetPosition: widget.config?.widgetPosition ?? DEFAULT_WIDGET_POSITION,
                  welcomeMessage: widget.config?.welcomeMessage ?? '',
                  showBranding: widget.config?.showBranding !== false,
                }}
                onSaved={applyAppearance}
              />

              <button type="button" onClick={() => void removeWidget()} disabled={widgetBusy} className="btn btn-ghost" style={{ marginTop: 20, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, color: 'var(--danger)' }}>
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

      {/* Email */}
      <div style={panel}>
        <div style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={icon}><Mail size={16} style={{ color: 'var(--accent)' }} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Email</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>
                {email ? `Answers as ${email.config?.fromAddress}` : 'Not connected'}
              </p>
            </div>
          </div>
          <span style={pill(Boolean(email))}>{email ? 'Live' : 'Off'}</span>
        </div>

        <div style={{ padding: 20 }}>
          {email ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 16 }}>
                Inbound mail to <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--panel-2)', padding: '1px 5px', borderRadius: 4, color: 'var(--accent)' }}>{email.config?.inboxAddress}</code> is answered by this agent.
              </p>
              <button type="button" onClick={() => void disconnectEmail()} disabled={emailBusy} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 16px', fontSize: 12.5 }}>
                {emailBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 12 }}>
                Connect a Resend mailbox — this agent will answer customer emails end-to-end.
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <input type="password" placeholder="Resend API key (re_…)" value={emailForm.resendApiKey} autoComplete="off" onChange={(e) => setEmailForm({ ...emailForm, resendApiKey: e.target.value })} style={input} />
                <input placeholder="From address (e.g. support@yourdomain.com)" value={emailForm.fromAddress} onChange={(e) => setEmailForm({ ...emailForm, fromAddress: e.target.value })} style={input} />
                <input placeholder="Inbox address (where customers write)" value={emailForm.inboxAddress} onChange={(e) => setEmailForm({ ...emailForm, inboxAddress: e.target.value })} style={input} />
                <input type="password" placeholder="Resend webhook signing secret" value={emailForm.webhookSecret} autoComplete="off" onChange={(e) => setEmailForm({ ...emailForm, webhookSecret: e.target.value })} style={input} />
              </div>
              <button
                type="button"
                onClick={() => void connectEmail()}
                disabled={emailBusy || !emailForm.resendApiKey || !emailForm.fromAddress || !emailForm.inboxAddress || !emailForm.webhookSecret}
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 16px', fontSize: 12.5, opacity: emailBusy || !emailForm.resendApiKey || !emailForm.fromAddress || !emailForm.inboxAddress || !emailForm.webhookSecret ? 0.6 : 1 }}
              >
                {emailBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Connect
              </button>
              {emailWebhookUrl && (
                <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                  <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 6px' }}>Paste this webhook URL into Resend&apos;s inbound email settings:</p>
                  <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--accent)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{emailWebhookUrl}</pre>
                </div>
              )}
            </>
          )}
          {emailError && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', ...errorText, marginTop: 10 }}>
              {emailError}
            </div>
          )}
        </div>
      </div>

      {/* Slack */}
      <div style={panel}>
        <div style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={icon}><SlackIcon size={16} style={{ color: 'var(--accent)' }} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0, textWrap: 'balance' }}>Slack</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, textWrap: 'pretty' }}>
                {slack ? `Connected to ${slack.slack?.teamName}` : 'Not connected'}
              </p>
            </div>
          </div>
          <span style={pill(Boolean(slack))}>{slack ? 'Live' : 'Off'}</span>
        </div>

        <div style={{ padding: 20 }}>
          {slack ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 14, lineHeight: 1.55, textWrap: 'pretty' }}>
                This agent answers direct messages and channel mentions in <strong style={{ color: 'var(--ink-dim)', fontWeight: 550 }}>{slack.slack?.teamName}</strong>. Channel answers stay inside the originating thread.
              </p>
              <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p style={{ ...label, marginBottom: 7 }}>Events API request URL</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, minWidth: 0, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    {slack.webhookUrl ?? slackWebhookUrl}
                  </code>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void copySlackWebhook(slack.webhookUrl ?? slackWebhookUrl)}
                    disabled={!slack.webhookUrl && !slackWebhookUrl}
                    aria-label="Copy Slack Events API request URL"
                    style={{ width: 40, height: 40, padding: 0, borderRadius: 10, justifyContent: 'center', flex: '0 0 auto' }}
                  >
                    {slackCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void disconnectSlack()} disabled={slackBusy} className="btn btn-ghost" style={{ minHeight: 40, padding: '8px 16px', fontSize: 12.5 }}>
                  {slackBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                  Disconnect
                </button>
                <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ minHeight: 40, padding: '8px 14px 8px 16px', fontSize: 12.5 }}>
                  Open Slack app settings <ExternalLink size={12} />
                </a>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 12, lineHeight: 1.55, textWrap: 'pretty' }}>
                Install a Slack app with a bot user, then paste its Bot User OAuth Token and Signing Secret. Both secrets are encrypted and never returned.
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <input
                  type="password"
                  placeholder="Bot User OAuth Token (xoxb-…)"
                  value={slackForm.botToken}
                  autoComplete="new-password"
                  onChange={(event) => { setSlackForm({ ...slackForm, botToken: event.target.value }); setSlackError('') }}
                  style={input}
                />
                <input
                  type="password"
                  placeholder="Signing Secret"
                  value={slackForm.signingSecret}
                  autoComplete="new-password"
                  onChange={(event) => { setSlackForm({ ...slackForm, signingSecret: event.target.value }); setSlackError('') }}
                  style={input}
                />
              </div>
              <button
                type="button"
                onClick={() => void connectSlack()}
                disabled={slackBusy || !slackForm.botToken.trim() || !slackForm.signingSecret.trim()}
                className="btn btn-primary"
                style={{ minHeight: 40, padding: '8px 16px', fontSize: 12.5, opacity: slackBusy || !slackForm.botToken.trim() || !slackForm.signingSecret.trim() ? 0.6 : 1 }}
              >
                {slackBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Verify & connect
              </button>
              <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p style={{ ...label, marginBottom: 8 }}>Slack app requirements</p>
                <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-mute)', fontSize: 11.5, lineHeight: 1.65 }}>
                  <li style={{ textWrap: 'pretty' }}>Bot scopes: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>chat:write</code>, <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>app_mentions:read</code>, and <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>im:history</code>.</li>
                  <li style={{ textWrap: 'pretty' }}>After connecting, paste the generated request URL into Event Subscriptions.</li>
                  <li style={{ textWrap: 'pretty' }}>Subscribe to <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>app_mention</code> and <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}>message.im</code>, then reinstall the app.</li>
                </ol>
              </div>
            </>
          )}
          {slackError && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', ...errorText, marginTop: 10 }}>
              {slackError}
            </div>
          )}
        </div>
      </div>

      {/* SMS */}
      <div style={panel}>
        <div style={head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={icon}><Smartphone size={16} style={{ color: 'var(--accent)' }} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', margin: 0, textWrap: 'balance' }}>SMS via Twilio</p>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, textWrap: 'pretty' }}>
                {sms ? `Connected on ${sms.twilio?.fromNumber}` : 'Not connected'}
              </p>
            </div>
          </div>
          <span style={pill(Boolean(sms))}>{sms ? 'Live' : 'Off'}</span>
        </div>

        <div style={{ padding: 20 }}>
          {sms ? (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 14, lineHeight: 1.55, textWrap: 'pretty' }}>
                This agent receives and answers text messages sent to <strong style={{ color: 'var(--ink-dim)', fontWeight: 550 }}>{sms.twilio?.fromNumber}</strong>. Replies from the Inbox are sent through the same number.
              </p>
              <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p style={{ ...label, marginBottom: 7 }}>Incoming-message webhook</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, minWidth: 0, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    {sms.webhookUrl ?? smsWebhookUrl}
                  </code>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void copySmsWebhook(sms.webhookUrl ?? smsWebhookUrl)}
                    disabled={!sms.webhookUrl && !smsWebhookUrl}
                    aria-label="Copy Twilio incoming-message webhook URL"
                    style={{ width: 40, height: 40, padding: 0, borderRadius: 10, justifyContent: 'center', flex: '0 0 auto' }}
                  >
                    {smsCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '9px 0 0', lineHeight: 1.55, textWrap: 'pretty' }}>
                  In Twilio, set this number&apos;s “A message comes in” handler to the URL above using HTTP POST.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void disconnectSms()} disabled={smsBusy} className="btn btn-ghost" style={{ minHeight: 40, padding: '8px 16px', fontSize: 12.5 }}>
                  {smsBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                  Disconnect
                </button>
                <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ minHeight: 40, padding: '8px 14px 8px 16px', fontSize: 12.5 }}>
                  Open Twilio numbers <ExternalLink size={12} />
                </a>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 12, lineHeight: 1.55, textWrap: 'pretty' }}>
                Connect a Twilio SMS-capable number. Ayooda verifies that the number belongs to the account; the Auth Token is encrypted and never returned.
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <input
                  placeholder="Account SID (AC…)"
                  value={smsForm.accountSid}
                  autoComplete="off"
                  onChange={(event) => { setSmsForm({ ...smsForm, accountSid: event.target.value }); setSmsError('') }}
                  style={input}
                />
                <input
                  type="password"
                  placeholder="Auth Token"
                  value={smsForm.authToken}
                  autoComplete="new-password"
                  onChange={(event) => { setSmsForm({ ...smsForm, authToken: event.target.value }); setSmsError('') }}
                  style={input}
                />
                <input
                  type="tel"
                  placeholder="Twilio number (for example +14155552671)"
                  value={smsForm.fromNumber}
                  autoComplete="tel"
                  onChange={(event) => { setSmsForm({ ...smsForm, fromNumber: event.target.value }); setSmsError('') }}
                  style={input}
                />
              </div>
              <button
                type="button"
                onClick={() => void connectSms()}
                disabled={smsBusy || !smsForm.accountSid.trim() || !smsForm.authToken.trim() || !smsForm.fromNumber.trim()}
                className="btn btn-primary"
                style={{ minHeight: 40, padding: '8px 16px', fontSize: 12.5, opacity: smsBusy || !smsForm.accountSid.trim() || !smsForm.authToken.trim() || !smsForm.fromNumber.trim() ? 0.6 : 1 }}
              >
                {smsBusy && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                Verify & connect
              </button>
              <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <p style={{ ...label, marginBottom: 8 }}>Twilio setup</p>
                <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-mute)', fontSize: 11.5, lineHeight: 1.65 }}>
                  <li style={{ textWrap: 'pretty' }}>Use an SMS-capable Twilio number owned by this account.</li>
                  <li style={{ textWrap: 'pretty' }}>Connect it here, then copy the generated webhook URL.</li>
                  <li style={{ textWrap: 'pretty' }}>Set the number&apos;s “A message comes in” webhook to that URL using HTTP POST.</li>
                </ol>
              </div>
            </>
          )}
          {smsError && (
            <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', ...errorText, marginTop: 10 }}>
              {smsError}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 'var(--r-md)', padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)', margin: '0 0 4px' }}>More channels coming soon</p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>WhatsApp, Messenger, and Instagram are on the roadmap.</p>
      </div>
    </>
  )
}
