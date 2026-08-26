'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Lock, MessageCircle, Monitor, Send, Smartphone, X } from 'lucide-react'
import {
  WIDGET_POSITIONS,
  MAX_WELCOME_MESSAGE_CHARS,
  type WidgetAppearance as Appearance,
  type WidgetPosition,
  isWidgetHexColor,
  normalizeWidgetHexColor,
  widgetAccessibleAccent,
  widgetForeground,
} from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { label, input, errorText } from './ui'

/** A scaled-down mock of the real widget, so a colour choice can be judged
 *  against the header, the launcher and a visitor bubble at once — the three
 *  places buildCSS() actually applies it. */
function Preview({ appearance, agentName, agentPhotoURL }: { appearance: Appearance; agentName: string; agentPhotoURL: string | null }) {
  const [mobile, setMobile] = useState(false)
  const [open, setOpen] = useState(true)
  const left = appearance.widgetPosition === 'bottom-left'
  const foreground = isWidgetHexColor(appearance.widgetColor) ? widgetForeground(appearance.widgetColor) : '#ffffff'
  const accent = isWidgetHexColor(appearance.widgetColor) ? widgetAccessibleAccent(appearance.widgetColor) : '#6366f1'
  return (
    <div
      style={{
        position: 'relative', height: 316, borderRadius: 'var(--r-sm)',
        border: '1px solid var(--line-2)', background: 'var(--bg-2)',
        overflow: 'hidden', padding: 12,
        display: 'flex', flexDirection: 'column',
        alignItems: left ? 'flex-start' : 'flex-end', justifyContent: 'flex-end', gap: 8,
      }}
    >
      <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', gap: 4 }}>
        <button type="button" aria-label="Desktop preview" onClick={() => setMobile(false)} className="btn btn-ghost" style={{ width: 32, height: 32, padding: 0, display: 'grid', placeItems: 'center', color: !mobile ? 'var(--accent)' : 'var(--ink-mute)' }}><Monitor size={14} /></button>
        <button type="button" aria-label="Mobile preview" onClick={() => setMobile(true)} className="btn btn-ghost" style={{ width: 32, height: 32, padding: 0, display: 'grid', placeItems: 'center', color: mobile ? 'var(--accent)' : 'var(--ink-mute)' }}><Smartphone size={14} /></button>
      </div>
      {/* Panel */}
      {open && <div style={{ width: mobile ? '100%' : 224, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
        <div style={{ background: isWidgetHexColor(appearance.widgetColor) ? appearance.widgetColor : '#6366f1', color: foreground, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 50, background: 'rgba(255,255,255,0.25)',
            display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 600, flexShrink: 0,
            overflow: 'hidden', boxShadow: '0 0 0 3px rgba(255,255,255,0.22), 0 2px 6px rgba(0,0,0,0.16)',
          }}>
            {agentPhotoURL
              // eslint-disable-next-line @next/next/no-img-element -- external agent identity URL
              ? <img src={agentPhotoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : agentName.charAt(0).toUpperCase()}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentName}</span>
          <X size={13} style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ minHeight: 116, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{
            alignSelf: 'flex-start', maxWidth: '85%', background: '#f4f4f5', color: '#18181b',
            fontSize: 9.5, lineHeight: 1.4, padding: '5px 7px', borderRadius: 8, borderBottomLeftRadius: 2,
          }}>
            {appearance.welcomeMessage || 'Your welcome message appears here.'}
          </span>
          <span style={{
            alignSelf: 'flex-end', background: isWidgetHexColor(appearance.widgetColor) ? appearance.widgetColor : '#6366f1', color: foreground,
            fontSize: 9.5, padding: '5px 7px', borderRadius: 8, borderBottomRightRadius: 2,
          }}>
            Hi — I need help
          </span>
        </div>
        <div style={{ margin: '0 8px 7px', minHeight: 44, border: '1px solid #d4d4d8', borderRadius: 10, padding: '8px 38px 8px 9px', color: '#a1a1aa', fontSize: 9.5, position: 'relative' }}>
          Type a message…
          <Send size={15} style={{ position: 'absolute', right: 10, bottom: 9, color: accent }} />
        </div>
        {appearance.showBranding && (
          <p style={{ textAlign: 'center', fontSize: 8, color: '#a1a1aa', margin: 0, padding: '0 0 6px' }}>
            Powered by Ayooda
          </p>
        )}
      </div>}
      {/* Launcher */}
      <button type="button" aria-label={open ? 'Close preview' : 'Open preview'} onClick={() => setOpen((value) => !value)} style={{
        border: 0, width: 40, height: 40, borderRadius: 50, background: isWidgetHexColor(appearance.widgetColor) ? appearance.widgetColor : '#6366f1', color: foreground,
        boxShadow: '0 3px 10px rgba(0,0,0,0.2)', display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        {open ? <X size={18} /> : <MessageCircle size={18} fill="currentColor" />}
      </button>
    </div>
  )
}

export default function WidgetAppearance({
  agentId, agentName, agentPhotoURL, initial, brandingLocked, onSaved,
}: {
  agentId: string
  agentName: string
  agentPhotoURL: string | null
  initial: Appearance
  /** True when the plan does not allow hiding the "Powered by Ayooda" line. */
  brandingLocked: boolean
  onSaved: (a: Appearance) => void
}) {
  const [draft, setDraft] = useState<Appearance>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const dirty =
    draft.widgetColor !== initial.widgetColor ||
    draft.widgetPosition !== initial.widgetPosition ||
    draft.welcomeMessage !== initial.welcomeMessage ||
    draft.showBranding !== initial.showBranding ||
    draft.allowedDomains.join('\n') !== initial.allowedDomains.join('\n')

  const tooLong = draft.welcomeMessage.length > MAX_WELCOME_MESSAGE_CHARS
  const validColor = isWidgetHexColor(draft.widgetColor)
  const canSave = dirty && validColor && !tooLong && draft.welcomeMessage.trim().length > 0

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await apiRequest(`/agents/${agentId}/channels/web-widget`, {
        method: 'PUT',
        body: JSON.stringify(draft),
      })
      const d = await res.json().catch(() => ({})) as Appearance & { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the appearance.'); return }
      onSaved(d)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save the appearance.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
      <p style={label}>Appearance</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20 }}>
        <div>
          <label htmlFor="w-color" style={{ fontSize: 12.5, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>Colour</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <input
              id="w-color" type="color" value={normalizeWidgetHexColor(draft.widgetColor) ?? '#6366f1'}
              onChange={(e) => setDraft({ ...draft, widgetColor: e.target.value })}
              style={{ width: 38, height: 34, padding: 2, borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', cursor: 'pointer' }}
            />
            <input
              aria-label="Colour hex value" value={draft.widgetColor}
              onChange={(e) => setDraft({ ...draft, widgetColor: e.target.value })}
              aria-invalid={!validColor}
              style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 13, width: 110, padding: '8px 10px' }}
            />
          </div>
          {!validColor && <p style={{ ...errorText, margin: '-9px 0 14px' }}>Use a hex colour such as #6366f1.</p>}

          <label htmlFor="w-pos" style={{ fontSize: 12.5, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>Position</label>
          <select
            id="w-pos" value={draft.widgetPosition}
            onChange={(e) => setDraft({ ...draft, widgetPosition: e.target.value as WidgetPosition })}
            style={{ ...input, padding: '8px 10px', fontSize: 13, marginBottom: 14 }}
          >
            {WIDGET_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <label htmlFor="w-welcome" style={{ fontSize: 12.5, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>
            Welcome message
          </label>
          <textarea
            id="w-welcome" value={draft.welcomeMessage}
            onChange={(e) => setDraft({ ...draft, welcomeMessage: e.target.value })}
            style={{ ...input, minHeight: 62, resize: 'vertical', fontSize: 13, padding: '8px 10px' }}
          />
          <p style={{ fontSize: 11, color: tooLong ? 'var(--danger)' : 'var(--ink-faint)', marginTop: 4 }}>
            {draft.welcomeMessage.length}/{MAX_WELCOME_MESSAGE_CHARS}
          </p>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: brandingLocked ? 'var(--ink-mute)' : 'var(--ink)', cursor: brandingLocked ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.showBranding}
                disabled={brandingLocked}
                onChange={(e) => setDraft({ ...draft, showBranding: e.target.checked })}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <span>
                Show &ldquo;Powered by Ayooda&rdquo;
                {brandingLocked && (
                  <Lock size={11} style={{ marginLeft: 6, verticalAlign: 'baseline', color: 'var(--ink-mute)' }} />
                )}
              </span>
            </label>
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '6px 0 0 24px' }}>
              {brandingLocked ? (
                <>
                  Removing the line is on Core and above.{' '}
                  <Link href="/dashboard/billing" style={{ color: 'var(--accent)' }}>Upgrade →</Link>
                </>
              ) : (
                'Turn this off to run the widget unbranded.'
              )}
            </p>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '14px 0 0' }}>
            The name and photo come from the agent&apos;s <Link href={`/dashboard/agents/${agentId}`} style={{ color: 'var(--accent)' }}>Info settings</Link>.
          </p>

          <details style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Advanced security</summary>
            <label htmlFor="w-domains" style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', margin: '12px 0 6px' }}>Allowed domains</label>
            <textarea
              id="w-domains"
              value={draft.allowedDomains.join('\n')}
              onChange={(event) => setDraft({ ...draft, allowedDomains: event.target.value.split('\n').map((domain) => domain.trim()).filter(Boolean) })}
              placeholder={'example.com\n*.example.com'}
              style={{ ...input, minHeight: 72, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px' }}
            />
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '5px 0 0', lineHeight: 1.5 }}>One hostname per line. Leave empty to allow the widget on any site.</p>
          </details>
        </div>

        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 6 }}>Preview</p>
          <Preview appearance={draft} agentName={agentName} agentPhotoURL={agentPhotoURL} />
        </div>
      </div>

      {error && <p style={{ ...errorText, marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button
          type="button" onClick={() => void save()} disabled={!canSave || saving}
          className="btn btn-primary"
          style={{
            borderRadius: 'var(--r-sm)', padding: '9px 16px', fontSize: 13,
            opacity: !canSave || saving ? 0.5 : 1, cursor: !canSave || saving ? 'not-allowed' : 'pointer',
            background: saved ? 'var(--mint)' : undefined, color: saved ? '#081a10' : undefined,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : saved ? <><Check size={13} /> Saved</>
            : 'Save appearance'}
        </button>
        {dirty && !saving && !saved && (
          <button type="button" onClick={() => { setDraft(initial); setError('') }} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '9px 14px', fontSize: 13 }}>
            Reset
          </button>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 10, marginBottom: 0 }}>
        Changes reach visitors on their next page load — the embed code stays the same.
      </p>
    </div>
  )
}
