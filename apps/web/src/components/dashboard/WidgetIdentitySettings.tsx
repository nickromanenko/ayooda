'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { AppSwitch } from '@/components/ui/AppSwitch'

interface IdentitySettings {
  enabled: boolean
  requireAuthentication: boolean
  hasSigningSecret: boolean
  lastVerifiedAt?: string | null
  failureCount?: number
}

export default function WidgetIdentitySettings({ agentId, channelId, initial }: {
  agentId: string
  channelId: string
  initial?: IdentitySettings
}) {
  const [settings, setSettings] = useState<IdentitySettings>(initial ?? { enabled: false, requireAuthentication: false, hasSigningSecret: false })
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const tokenExample = useMemo(() => `// Run on your server — never expose the signing secret in browser code.
import { SignJWT } from 'jose'

const identityToken = await new SignJWT({
  name: user.name,
  email: user.email,
})
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setSubject(user.id) // stable ID in your system
  .setAudience('ayooda-widget:${channelId}')
  .setIssuedAt()
  .setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.AYOODA_IDENTITY_SECRET))`, [channelId])

  async function save(next: Partial<IdentitySettings> = {}) {
    const value = { ...settings, ...next }
    setBusy(true); setError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/channels/web-widget/identity`, {
        method: 'PUT', body: JSON.stringify({ enabled: value.enabled, requireAuthentication: value.requireAuthentication }),
      })
      const data = await response.json().catch(() => ({})) as IdentitySettings & { signingSecret?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not save identity settings.')
      setSettings((current) => ({ ...current, ...data }))
      if (data.signingSecret) setSecret(data.signingSecret)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save identity settings.') }
    finally { setBusy(false) }
  }

  async function rotate() {
    setBusy(true); setError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/channels/web-widget/identity/rotate`, { method: 'POST' })
      const data = await response.json().catch(() => ({})) as { signingSecret?: string; error?: string }
      if (!response.ok || !data.signingSecret) throw new Error(data.error ?? 'Could not rotate the signing secret.')
      setSecret(data.signingSecret); setSettings((current) => ({ ...current, enabled: true, hasSigningSecret: true })); setConfirmRotate(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not rotate the signing secret.') }
    finally { setBusy(false) }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(secret); setCopied(true); window.setTimeout(() => setCopied(false), 1800)
  }

  return <section style={{ marginTop: 20, border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--panel)', overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-text)' }}><ShieldCheck size={17} /></span>
      <div><h3 style={{ margin: 0, color: 'var(--ink)', fontSize: 14, textWrap: 'balance' }}>Authenticated visitors</h3><p style={{ margin: '2px 0 0', color: 'var(--ink-mute)', fontSize: 12, textWrap: 'pretty' }}>Recognize signed-in customers securely and continue their conversation across devices.</p></div>
    </div>
    <div style={{ padding: 20 }}>
      <AppSwitch controlPosition="end" checked={settings.enabled} disabled={busy} onChange={(enabled) => { void save({ enabled, requireAuthentication: enabled ? settings.requireAuthentication : false }) }} label="Verify signed-in customers" description="Accept only server-signed identity tokens." />
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}><AppSwitch controlPosition="end" checked={settings.requireAuthentication} disabled={busy || !settings.enabled} onChange={(requireAuthentication) => void save({ requireAuthentication })} label="Require authentication" description="Block guest conversations. Leave off to support both guests and signed-in customers." /></div>

      {settings.enabled && <details style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--bg-2)', overflow: 'hidden' }}>
        <summary style={{ minHeight: 44, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600 }}><KeyRound size={14} /> Server setup</summary>
        <div style={{ borderTop: '1px solid var(--line)', padding: 14 }}>
          {secret && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(245,158,11,.09)', border: '1px solid rgba(245,158,11,.25)' }}><strong style={{ color: 'var(--ink)', fontSize: 12.5 }}>Copy this secret now</strong><p style={{ margin: '4px 0 9px', color: 'var(--ink-mute)', fontSize: 12 }}>It is shown once. Store it as <code>AYOODA_IDENTITY_SECRET</code> on your server.</p><div style={{ display: 'flex', gap: 8 }}><code style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 8, background: 'var(--panel)', color: 'var(--ink-dim)', fontSize: 11.5, overflowWrap: 'anywhere' }}>{secret}</code><button type="button" className="btn btn-ghost" onClick={() => void copySecret()} style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center' }} aria-label="Copy signing secret">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div></div>}
          <p style={{ margin: '0 0 8px', color: 'var(--ink-mute)', fontSize: 12, lineHeight: 1.55, textWrap: 'pretty' }}>Create a JWT after your server authenticates the customer. Tokens may live for at most 15 minutes.</p>
          <pre style={{ margin: 0, padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink-dim)', font: '11.5px/1.55 var(--font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tokenExample}</pre>
          <p style={{ margin: '14px 0 8px', color: 'var(--ink-mute)', fontSize: 12 }}>Send the token to the widget after login. Call <code>shutdown</code> before clearing your app session.</p>
          <pre style={{ margin: 0, padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink-dim)', font: '11.5px/1.55 var(--font-mono)', whiteSpace: 'pre-wrap' }}>{`// Safe to run before the async widget script has loaded
window.Ayooda = window.Ayooda || function (...args) {
  (window.Ayooda.q = window.Ayooda.q || []).push(args)
}
window.Ayooda('boot', { identityToken })

// When the user changes
window.Ayooda('update', { identityToken })

// On logout or a shared device
window.Ayooda('shutdown')`}</pre>
          <p style={{ margin: '12px 0 0', color: 'var(--ink-faint)', fontSize: 11.5 }}>When rotated, the previous secret remains valid for one hour so you can deploy the new value without downtime.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            {!confirmRotate ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmRotate(true)} style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 7 }}><RefreshCw size={13} /> Rotate secret</button> : <><button type="button" className="btn btn-ghost" onClick={() => setConfirmRotate(false)} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void rotate()} disabled={busy}>{busy && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} Confirm rotation</button></>}
          </div>
        </div>
      </details>}
      <a href="/docs/widget-identity" target="_blank" rel="noreferrer" style={{ minHeight: 40, marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-text)', fontSize: 12, textDecoration: 'none' }}>Read the complete integration guide <ExternalLink size={12} /></a>
      {settings.lastVerifiedAt && <p style={{ color: 'var(--ink-faint)', fontSize: 11.5, margin: '12px 0 0' }}>Last verified customer: {new Date(settings.lastVerifiedAt).toLocaleString()}{settings.failureCount ? ` · ${settings.failureCount} failed token${settings.failureCount === 1 ? '' : 's'}` : ''}</p>}
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12, margin: '12px 0 0' }}>{error}</p>}
    </div>
  </section>
}
