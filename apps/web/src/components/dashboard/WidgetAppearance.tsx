'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import {
  WIDGET_POSITIONS,
  MAX_WELCOME_MESSAGE_CHARS,
  type WidgetAppearance as Appearance,
  type WidgetPosition,
} from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { label, input, errorText } from './ui'

/** A scaled-down mock of the real widget, so a colour choice can be judged
 *  against the header, the launcher and a visitor bubble at once — the three
 *  places buildCSS() actually applies it. */
function Preview({ appearance, agentName }: { appearance: Appearance; agentName: string }) {
  const left = appearance.widgetPosition === 'bottom-left'
  return (
    <div
      aria-hidden
      style={{
        position: 'relative', height: 232, borderRadius: 'var(--r-sm)',
        border: '1px solid var(--line-2)', background: 'var(--bg-2)',
        overflow: 'hidden', padding: 12,
        display: 'flex', flexDirection: 'column',
        alignItems: left ? 'flex-start' : 'flex-end', justifyContent: 'flex-end', gap: 8,
      }}
    >
      {/* Panel */}
      <div style={{ width: 190, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
        <div style={{ background: appearance.widgetColor, color: '#fff', padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 18, height: 18, borderRadius: 50, background: 'rgba(255,255,255,0.25)',
            display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 600, flexShrink: 0,
          }}>
            {agentName.charAt(0).toUpperCase()}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agentName}</span>
        </div>
        <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{
            alignSelf: 'flex-start', maxWidth: '85%', background: '#f4f4f5', color: '#18181b',
            fontSize: 9.5, lineHeight: 1.4, padding: '5px 7px', borderRadius: 8, borderBottomLeftRadius: 2,
          }}>
            {appearance.welcomeMessage || 'Your welcome message appears here.'}
          </span>
          <span style={{
            alignSelf: 'flex-end', background: appearance.widgetColor, color: '#fff',
            fontSize: 9.5, padding: '5px 7px', borderRadius: 8, borderBottomRightRadius: 2,
          }}>
            Hi — I need help
          </span>
        </div>
      </div>
      {/* Launcher */}
      <div style={{
        width: 30, height: 30, borderRadius: 50, background: appearance.widgetColor,
        boxShadow: '0 3px 10px rgba(0,0,0,0.2)', display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" /></svg>
      </div>
    </div>
  )
}

export default function WidgetAppearance({
  agentId, agentName, initial, onSaved,
}: {
  agentId: string
  agentName: string
  initial: Appearance
  onSaved: (a: Appearance) => void
}) {
  const [draft, setDraft] = useState<Appearance>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const dirty =
    draft.widgetColor !== initial.widgetColor ||
    draft.widgetPosition !== initial.widgetPosition ||
    draft.welcomeMessage !== initial.welcomeMessage

  const tooLong = draft.welcomeMessage.length > MAX_WELCOME_MESSAGE_CHARS
  const canSave = dirty && !tooLong && draft.welcomeMessage.trim().length > 0

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
              id="w-color" type="color" value={draft.widgetColor}
              onChange={(e) => setDraft({ ...draft, widgetColor: e.target.value })}
              style={{ width: 38, height: 34, padding: 2, borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', cursor: 'pointer' }}
            />
            <input
              aria-label="Colour hex value" value={draft.widgetColor}
              onChange={(e) => setDraft({ ...draft, widgetColor: e.target.value })}
              style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 13, width: 110, padding: '8px 10px' }}
            />
          </div>

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
          <p style={{ fontSize: 11, color: tooLong ? '#f87171' : 'var(--ink-faint)', marginTop: 4 }}>
            {draft.welcomeMessage.length}/{MAX_WELCOME_MESSAGE_CHARS}
          </p>
        </div>

        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 6 }}>Preview</p>
          <Preview appearance={draft} agentName={agentName} />
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
