'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronRight, CircleAlert, Loader2, Lock, MessageCircle, Monitor, Plus, Send, Smartphone, X } from 'lucide-react'
import {
  WIDGET_POSITIONS, WIDGET_THEMES, WIDGET_LOCALES, MAX_WELCOME_MESSAGE_CHARS,
  isWidgetHexColor, normalizeWidgetHexColor, widgetAccessibleAccent,
  widgetContrastRatio, widgetForeground, type WidgetAppearance as Appearance,
  type WidgetPosition,
} from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { label, input, errorText } from './ui'

type SettingsTab = 'appearance' | 'content' | 'behavior' | 'security'
type PreviewScenario = 'welcome' | 'markdown' | 'handoff' | 'error'

const PREVIEW_STRINGS = {
  en: { online: 'Online', compose: 'Compose your message…', privacy: 'Privacy', powered: 'Powered by Ayooda', waiting: 'Waiting for a teammate', retry: 'Try again', failed: 'The message could not be sent.' },
  es: { online: 'En línea', compose: 'Escribe tu mensaje…', privacy: 'Privacidad', powered: 'Funciona con Ayooda', waiting: 'Esperando a un miembro del equipo', retry: 'Intentar de nuevo', failed: 'No se pudo enviar el mensaje.' },
  fr: { online: 'En ligne', compose: 'Écrivez votre message…', privacy: 'Confidentialité', powered: 'Propulsé par Ayooda', waiting: "En attente d'un membre de l'équipe", retry: 'Réessayer', failed: "Le message n'a pas pu être envoyé." },
  de: { online: 'Online', compose: 'Nachricht verfassen…', privacy: 'Datenschutz', powered: 'Bereitgestellt von Ayooda', waiting: 'Warten auf ein Teammitglied', retry: 'Erneut versuchen', failed: 'Die Nachricht konnte nicht gesendet werden.' },
  pt: { online: 'Online', compose: 'Escreva sua mensagem…', privacy: 'Privacidade', powered: 'Desenvolvido por Ayooda', waiting: 'Aguardando um membro da equipe', retry: 'Tentar novamente', failed: 'Não foi possível enviar a mensagem.' },
  ar: { online: 'متصل', compose: 'اكتب رسالتك…', privacy: 'الخصوصية', powered: 'مدعوم من Ayooda', waiting: 'في انتظار أحد أعضاء الفريق', retry: 'حاول مرة أخرى', failed: 'تعذر إرسال الرسالة.' },
} as const

const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12.5, color: 'var(--ink-mute)' }
const help: React.CSSProperties = { margin: '5px 0 0', fontSize: 11, lineHeight: 1.5, color: 'var(--ink-faint)', textWrap: 'pretty' }
const group: React.CSSProperties = { marginBottom: 16 }

function Toggle({ checked, onChange, title, description, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; title: string; description?: string; disabled?: boolean }) {
  return <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .65 : 1 }}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} style={{ marginTop: 3 }} />
    <span><span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }}>{title}</span>{description && <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-faint)', textWrap: 'pretty' }}>{description}</span>}</span>
  </label>
}

function LinesInput({ id, value, onChange, placeholder }: { id: string; value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
  return <textarea id={id} value={value.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} placeholder={placeholder} style={{ ...input, minHeight: 74, resize: 'vertical', padding: '9px 11px', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
}

function Preview({ appearance, agentName, agentPhotoURL }: { appearance: Appearance; agentName: string; agentPhotoURL: string | null }) {
  const [mobile, setMobile] = useState(false)
  const [open, setOpen] = useState(true)
  const [scenario, setScenario] = useState<PreviewScenario>('welcome')
  const foreground = isWidgetHexColor(appearance.widgetColor) ? widgetForeground(appearance.widgetColor) : '#fff'
  const accent = isWidgetHexColor(appearance.widgetColor) ? widgetAccessibleAccent(appearance.widgetColor) : '#6366f1'
  const dark = appearance.theme === 'dark'
  const panel = dark ? '#18181b' : '#fff'
  const ink = dark ? '#fafafa' : '#18181b'
  const muted = dark ? '#a1a1aa' : '#71717a'
  const bot = dark ? '#27272a' : '#f4f4f5'
  const brand = isWidgetHexColor(appearance.widgetColor) ? appearance.widgetColor : '#6366f1'
  const previewLocale = appearance.locale === 'auto' ? 'en' : appearance.locale
  const ui = PREVIEW_STRINGS[previewLocale]
  const sample = scenario === 'welcome'
    ? <span>{appearance.welcomeMessage || 'Your welcome message appears here.'}</span>
    : scenario === 'markdown'
      ? <><strong>Here are the next steps:</strong><ul style={{ margin: '5px 0 0', paddingLeft: 16 }}><li>Review your account</li><li>Choose a plan</li></ul></>
      : scenario === 'handoff'
        ? <><span>I’ll bring in a teammate.</span><small style={{ display: 'block', marginTop: 7, color: muted }}>{ui.waiting}</small></>
        : <><span style={{ color: '#dc2626' }}>{ui.failed}</span><button type="button" style={{ display: 'block', marginTop: 7, border: '1px solid #dc2626', borderRadius: 6, background: 'transparent', color: '#dc2626', fontSize: 8 }}>{ui.retry}</button></>

  return <div style={{ position: 'sticky', top: 18 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}><p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-mute)' }}>Live preview</p><div style={{ display: 'flex', gap: 4 }}><button type="button" aria-label="Desktop preview" onClick={() => setMobile(false)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: !mobile ? 'var(--accent)' : 'var(--ink-mute)' }}><Monitor size={14} /></button><button type="button" aria-label="Mobile preview" onClick={() => setMobile(true)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: mobile ? 'var(--accent)' : 'var(--ink-mute)' }}><Smartphone size={14} /></button></div></div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto' }}>{(['welcome', 'markdown', 'handoff', 'error'] as const).map((item) => <button key={item} type="button" onClick={() => setScenario(item)} style={{ minHeight: 34, padding: '0 10px', borderRadius: 999, border: 0, background: scenario === item ? 'var(--accent-soft)' : 'var(--bg-2)', color: scenario === item ? 'var(--accent)' : 'var(--ink-mute)', fontSize: 10.5, textTransform: 'capitalize', cursor: 'pointer' }}>{item}</button>)}</div>
    <div style={{ position: 'relative', height: 372, padding: 12, borderRadius: 16, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.07), 0 4px 14px rgba(0,0,0,.06)', display: 'flex', flexDirection: 'column', alignItems: appearance.widgetPosition === 'bottom-left' ? 'flex-start' : 'flex-end', justifyContent: 'flex-end', gap: 8, overflow: 'hidden' }}>
      {appearance.launcherGreeting && !open && <div style={{ maxWidth: 190, padding: '8px 10px', borderRadius: 10, background: panel, color: ink, fontSize: 9.5, boxShadow: '0 4px 14px rgba(0,0,0,.14)' }}>{appearance.launcherGreeting}</div>}
      {open && <div dir={previewLocale === 'ar' ? 'rtl' : 'ltr'} style={{ width: mobile ? '100%' : 236, background: panel, color: ink, borderRadius: 13, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>
        <div style={{ minHeight: 44, padding: '8px 9px', background: brand, color: foreground, display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 24, height: 24, borderRadius: 99, overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.2)', boxShadow: '0 0 0 3px rgba(255,255,255,.2)' }}>{agentPhotoURL ? <img src={agentPhotoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', outline: '1px solid rgba(0,0,0,.1)', outlineOffset: -1 }} /> : agentName.slice(0, 1)}</span><span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>{appearance.headerTitle || agentName}</strong><small style={{ display: 'block', marginTop: 1, opacity: .8, fontSize: 8 }}>{appearance.statusText || ui.online}</small></span><X size={13} /></div>
        <div style={{ minHeight: 155, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}><div style={{ alignSelf: 'flex-start', maxWidth: '88%', padding: '7px 8px', borderRadius: '9px 9px 9px 3px', background: bot, color: ink, fontSize: 9, lineHeight: 1.42 }}>{sample}</div>{scenario !== 'error' && <div style={{ alignSelf: 'flex-end', padding: '6px 8px', borderRadius: '9px 9px 3px 9px', background: brand, color: foreground, fontSize: 9 }}>Thanks — that helps</div>}</div>
        <div style={{ position: 'relative', minHeight: 50, margin: '0 8px 7px', padding: '9px 35px 9px 9px', borderRadius: 10, color: muted, boxShadow: `0 0 0 1px ${dark ? '#3f3f46' : '#d4d4d8'}`, fontSize: 9 }}>{appearance.inputPlaceholder || ui.compose}<Send size={14} style={{ position: 'absolute', right: 10, bottom: 9, color: accent }} /></div>
        {(appearance.showBranding || appearance.privacyPolicyURL) && <p style={{ margin: '0 0 7px', textAlign: 'center', color: muted, fontSize: 7.5 }}>{appearance.privacyPolicyURL && `${ui.privacy} · `}{appearance.showBranding && ui.powered}</p>}
      </div>}
      <button type="button" aria-label={open ? 'Close preview' : 'Open preview'} onClick={() => setOpen((value) => !value)} style={{ width: 44, height: 44, border: 0, borderRadius: 99, background: brand, color: foreground, display: 'grid', placeItems: 'center', boxShadow: '0 5px 16px rgba(0,0,0,.22)', cursor: 'pointer', transitionProperty: 'transform, box-shadow', transitionDuration: '150ms' }}>{open ? <X size={19} /> : <MessageCircle size={19} fill="currentColor" />}</button>
    </div><p style={{ ...help, marginTop: 8 }}>{appearance.theme === 'auto' ? 'Auto theme follows the visitor’s device.' : `${appearance.theme[0]!.toUpperCase()}${appearance.theme.slice(1)} theme preview.`}</p>
  </div>
}

export default function WidgetAppearance({ agentId, agentName, agentPhotoURL, initial, brandingLocked, onSaved }: { agentId: string; agentName: string; agentPhotoURL: string | null; initial: Appearance; brandingLocked: boolean; onSaved: (appearance: Appearance) => void }) {
  const [draft, setDraft] = useState<Appearance>(initial)
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [domainEntry, setDomainEntry] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const validColor = isWidgetHexColor(draft.widgetColor)
  const tooLong = draft.welcomeMessage.length > MAX_WELCOME_MESSAGE_CHARS
  const canSave = dirty && validColor && !tooLong && draft.welcomeMessage.trim().length > 0
  const contrast = useMemo(() => validColor ? Math.max(widgetContrastRatio(draft.widgetColor, '#fff'), widgetContrastRatio(draft.widgetColor, '#18181b')) : 0, [draft.widgetColor, validColor])

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await apiRequest(`/agents/${agentId}/channels/web-widget`, { method: 'PUT', body: JSON.stringify(draft) })
      const data = await response.json().catch(() => ({})) as Appearance & { error?: string }
      if (!response.ok) { setError(data.error ?? 'Could not save the widget settings.'); return }
      setDraft(data); onSaved(data); setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch { setError('Could not save the widget settings.') } finally { setSaving(false) }
  }

  function addDomain() {
    const domain = domainEntry.trim().toLowerCase()
    if (!domain || draft.allowedDomains.includes(domain)) return
    setDraft({ ...draft, allowedDomains: [...draft.allowedDomains, domain] }); setDomainEntry('')
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [{ id: 'appearance', label: 'Appearance' }, { id: 'content', label: 'Content' }, { id: 'behavior', label: 'Behavior' }, { id: 'security', label: 'Security' }]

  return <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', marginBottom: 14 }}><div><p style={{ ...label, marginBottom: 4 }}>Widget settings</p><p style={{ margin: 0, maxWidth: 520, color: 'var(--ink-mute)', fontSize: 12, lineHeight: 1.5, textWrap: 'pretty' }}>Control what visitors see, where the widget appears, and how conversations behave.</p></div><span style={{ padding: '4px 9px', borderRadius: 99, background: draft.enabled ? 'rgba(52,211,153,.14)' : 'var(--panel-2)', color: draft.enabled ? 'var(--mint)' : 'var(--ink-mute)', font: '500 10.5px var(--font-mono)' }}>{draft.enabled ? 'Enabled' : 'Paused'}</span></div>
    <div role="tablist" aria-label="Widget settings" style={{ display: 'flex', gap: 4, marginBottom: 18, overflowX: 'auto' }}>{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} style={{ minHeight: 40, padding: '0 13px', border: 0, borderRadius: 9, background: activeTab === tab.id ? 'var(--accent-soft)' : 'transparent', color: activeTab === tab.id ? 'var(--accent)' : 'var(--ink-mute)', fontSize: 12.5, fontWeight: activeTab === tab.id ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', transitionProperty: 'background-color, color, transform', transitionDuration: '150ms' }}>{tab.label}</button>)}</div>
    <div className="widget-settings-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(260px, .95fr)', gap: 24, alignItems: 'start' }}><div role="tabpanel">
      {activeTab === 'appearance' && <>
        <div style={group}><label htmlFor="w-color" style={fieldLabel}>Brand colour</label><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><input id="w-color" type="color" value={normalizeWidgetHexColor(draft.widgetColor) ?? '#6366f1'} onChange={(event) => setDraft({ ...draft, widgetColor: event.target.value })} style={{ width: 44, height: 40, padding: 3, borderRadius: 9, border: '1px solid var(--line-2)', background: 'var(--bg-2)' }} /><input aria-label="Colour hex value" value={draft.widgetColor} aria-invalid={!validColor} onChange={(event) => setDraft({ ...draft, widgetColor: event.target.value })} style={{ ...input, width: 120, padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 13 }} /><span style={{ padding: '4px 8px', borderRadius: 99, background: validColor ? 'rgba(52,211,153,.14)' : 'rgba(239,68,68,.12)', color: validColor ? 'var(--mint)' : 'var(--danger)', font: '500 10.5px var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{validColor ? `${contrast.toFixed(1)}:1 · Accessible` : 'Invalid'}</span></div>{!validColor && <p style={{ ...errorText, marginTop: 6 }}>Use a hex colour such as #6366f1.</p>}</div>
        <div style={group}><label htmlFor="w-theme" style={fieldLabel}>Panel theme</label><select id="w-theme" value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Appearance['theme'] })} style={{ ...input, padding: '9px 10px', fontSize: 13 }}>{WIDGET_THEMES.map((theme) => <option key={theme} value={theme}>{theme === 'auto' ? 'Match visitor device' : `${theme[0]!.toUpperCase()}${theme.slice(1)}`}</option>)}</select></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div style={group}><label htmlFor="w-pos" style={fieldLabel}>Position</label><select id="w-pos" value={draft.widgetPosition} onChange={(event) => setDraft({ ...draft, widgetPosition: event.target.value as WidgetPosition })} style={{ ...input, padding: '9px 10px', fontSize: 13 }}>{WIDGET_POSITIONS.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}</select></div><div style={group}><label htmlFor="w-offset-y" style={fieldLabel}>Bottom offset</label><input id="w-offset-y" type="number" min={8} max={96} value={draft.verticalOffset} onChange={(event) => setDraft({ ...draft, verticalOffset: Number(event.target.value) })} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /></div></div>
        <div style={group}><label htmlFor="w-offset-x" style={fieldLabel}>Side offset</label><input id="w-offset-x" type="number" min={8} max={96} value={draft.horizontalOffset} onChange={(event) => setDraft({ ...draft, horizontalOffset: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /><p style={help}>Useful around cookie banners and floating controls.</p></div>
        <Toggle checked={draft.showBranding} disabled={brandingLocked} onChange={(checked) => setDraft({ ...draft, showBranding: checked })} title="Show “Powered by Ayooda”" description={brandingLocked ? 'Removing attribution is available on Core and above.' : 'Turn this off to run the widget unbranded.'} />{brandingLocked && <p style={{ ...help, marginLeft: 25 }}><Lock size={10} /> <Link href="/dashboard/billing" style={{ color: 'var(--accent)' }}>Upgrade to unlock</Link></p>}
      </>}
      {activeTab === 'content' && <>
        <div style={group}><label htmlFor="w-title" style={fieldLabel}>Header title</label><input id="w-title" value={draft.headerTitle} onChange={(event) => setDraft({ ...draft, headerTitle: event.target.value })} placeholder={agentName} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><p style={help}>Leave blank to use the agent name from <Link href={`/dashboard/agents/${agentId}`} style={{ color: 'var(--accent)' }}>Info settings</Link>.</p></div>
        <div style={group}><label htmlFor="w-status" style={fieldLabel}>Header subtitle</label><input id="w-status" value={draft.statusText} onChange={(event) => setDraft({ ...draft, statusText: event.target.value })} placeholder="Online" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /></div>
        <div style={group}><label htmlFor="w-welcome" style={fieldLabel}>Welcome message</label><textarea id="w-welcome" value={draft.welcomeMessage} onChange={(event) => setDraft({ ...draft, welcomeMessage: event.target.value })} style={{ ...input, minHeight: 76, resize: 'vertical', padding: '9px 10px', fontSize: 13 }} /><p style={{ ...help, color: tooLong ? 'var(--danger)' : 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}>{draft.welcomeMessage.length}/{MAX_WELCOME_MESSAGE_CHARS}</p></div>
        <div style={group}><label htmlFor="w-placeholder" style={fieldLabel}>Message placeholder</label><input id="w-placeholder" value={draft.inputPlaceholder} onChange={(event) => setDraft({ ...draft, inputPlaceholder: event.target.value })} placeholder="Compose your message…" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /></div>
        <div style={group}><label htmlFor="w-greeting" style={fieldLabel}>Launcher greeting</label><input id="w-greeting" value={draft.launcherGreeting} onChange={(event) => setDraft({ ...draft, launcherGreeting: event.target.value })} placeholder="Need help? Chat with us." style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><p style={help}>Optional prompt shown beside the launcher.</p></div>
        <div style={group}><label htmlFor="w-locale" style={fieldLabel}>Interface language</label><select id="w-locale" value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value as Appearance['locale'] })} style={{ ...input, padding: '9px 10px', fontSize: 13 }}>{WIDGET_LOCALES.map((locale) => <option key={locale} value={locale}>{({ auto: 'Automatic', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ar: 'العربية' } as const)[locale]}</option>)}</select></div>
      </>}
      {activeTab === 'behavior' && <>
        <Toggle checked={draft.enabled} onChange={(checked) => setDraft({ ...draft, enabled: checked })} title="Widget enabled" description="Pause it without changing the embed code." /><div style={{ height: 1, margin: '8px 0 16px', background: 'var(--line)' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div style={group}><label htmlFor="w-auto-open" style={fieldLabel}>Auto-open delay</label><input id="w-auto-open" type="number" min={0} max={60} value={draft.autoOpenDelaySeconds} onChange={(event) => setDraft({ ...draft, autoOpenDelaySeconds: Number(event.target.value) })} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><p style={help}>Seconds; 0 disables it.</p></div><div style={group}><label htmlFor="w-greeting-delay" style={fieldLabel}>Greeting delay</label><input id="w-greeting-delay" type="number" min={0} max={60} value={draft.launcherGreetingDelaySeconds} onChange={(event) => setDraft({ ...draft, launcherGreetingDelaySeconds: Number(event.target.value) })} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /></div></div>
        <Toggle checked={draft.autoOpenOncePerSession} onChange={(checked) => setDraft({ ...draft, autoOpenOncePerSession: checked })} title="Auto-open only once per session" /><div style={{ marginTop: 12 }}><Toggle checked={draft.showOnDesktop} onChange={(checked) => setDraft({ ...draft, showOnDesktop: checked })} title="Show on desktop" /><Toggle checked={draft.showOnMobile} onChange={(checked) => setDraft({ ...draft, showOnMobile: checked })} title="Show on mobile" /></div>
        <div style={group}><label htmlFor="w-include" style={fieldLabel}>Only show on paths</label><LinesInput id="w-include" value={draft.includePaths} onChange={(value) => setDraft({ ...draft, includePaths: value })} placeholder={'/pricing\n/help/*'} /><p style={help}>One pattern per line. Empty includes every page.</p></div><div style={group}><label htmlFor="w-exclude" style={fieldLabel}>Hide on paths</label><LinesInput id="w-exclude" value={draft.excludePaths} onChange={(value) => setDraft({ ...draft, excludePaths: value })} placeholder={'/checkout/*\n/admin/*'} /></div>
        <div style={group}><label htmlFor="w-persistence" style={fieldLabel}>Conversation memory</label><select id="w-persistence" value={draft.conversationPersistence} onChange={(event) => setDraft({ ...draft, conversationPersistence: event.target.value as Appearance['conversationPersistence'] })} style={{ ...input, padding: '9px 10px', fontSize: 13 }}><option value="session">Remember in this browser tab</option><option value="visitor">Remember returning visitors</option><option value="fresh">Always start fresh</option></select></div>{draft.conversationPersistence === 'visitor' && <div style={group}><label htmlFor="w-days" style={fieldLabel}>Remember for days</label><input id="w-days" type="number" min={1} max={30} value={draft.persistenceDays} onChange={(event) => setDraft({ ...draft, persistenceDays: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /></div>}
        <Toggle checked={draft.soundEnabled} onChange={(checked) => setDraft({ ...draft, soundEnabled: checked })} title="Reply sound" description="Play a subtle sound for replies received while closed." />
      </>}
      {activeTab === 'security' && <>
        <div style={{ marginBottom: 18, padding: 13, borderRadius: 12, background: draft.allowedDomains.length ? 'rgba(52,211,153,.08)' : 'rgba(245,158,11,.09)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }}><p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink)', display: 'flex', gap: 7, alignItems: 'center' }}>{draft.allowedDomains.length ? <Check size={14} style={{ color: 'var(--mint)' }} /> : <CircleAlert size={14} style={{ color: '#d97706' }} />}{draft.allowedDomains.length ? 'Embedding is restricted' : 'Any website can currently embed this widget'}</p></div>
        <div style={group}><label htmlFor="w-domain" style={fieldLabel}>Allowed domains</label><div style={{ display: 'flex', gap: 7 }}><input id="w-domain" value={domainEntry} onChange={(event) => setDomainEntry(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDomain() } }} placeholder="example.com or *.example.com" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><button type="button" onClick={addDomain} aria-label="Add domain" className="btn btn-ghost" style={{ width: 44, height: 44, padding: 0, display: 'grid', placeItems: 'center' }}><Plus size={14} /></button></div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{draft.allowedDomains.map((domain) => <span key={domain} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 30, padding: '0 7px 0 9px', borderRadius: 99, background: 'var(--panel-2)', color: 'var(--ink-dim)', font: '11px var(--font-mono)' }}>{domain}<button type="button" aria-label={`Remove ${domain}`} onClick={() => setDraft({ ...draft, allowedDomains: draft.allowedDomains.filter((item) => item !== domain) })} style={{ width: 24, height: 24, border: 0, borderRadius: 99, background: 'transparent', color: 'var(--ink-mute)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={11} /></button></span>)}</div></div>
        <div style={group}><label htmlFor="w-privacy-url" style={fieldLabel}>Privacy policy URL</label><input id="w-privacy-url" type="url" value={draft.privacyPolicyURL} onChange={(event) => setDraft({ ...draft, privacyPolicyURL: event.target.value })} placeholder="https://example.com/privacy" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /></div><div style={group}><label htmlFor="w-privacy-notice" style={fieldLabel}>Privacy notice</label><textarea id="w-privacy-notice" value={draft.privacyNotice} onChange={(event) => setDraft({ ...draft, privacyNotice: event.target.value })} placeholder="Messages may be stored to provide support." style={{ ...input, minHeight: 70, resize: 'vertical', padding: '9px 10px', fontSize: 13 }} /></div>
      </>}
    </div><Preview appearance={draft} agentName={agentName} agentPhotoURL={agentPhotoURL} /></div>
    {error && <p style={{ ...errorText, marginTop: 14 }}>{error}</p>}
    <div style={{ position: 'sticky', bottom: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, padding: '12px 0', background: 'linear-gradient(transparent, var(--panel) 28%)' }}><button type="button" onClick={() => void save()} disabled={!canSave || saving} className="btn btn-primary" style={{ minHeight: 42, padding: '0 16px', borderRadius: 9, opacity: !canSave || saving ? .5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : saved ? <><Check size={13} /> Saved</> : 'Save widget settings'}</button>{dirty && !saving && !saved && <button type="button" onClick={() => { setDraft(initial); setError('') }} className="btn btn-ghost" style={{ minHeight: 42, padding: '0 14px' }}>Reset</button>}<Link href={`/dashboard/agents/${agentId}/usage`} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-mute)', fontSize: 11.5, textDecoration: 'none' }}>View widget usage <ChevronRight size={12} /></Link></div>
  </div>
}
