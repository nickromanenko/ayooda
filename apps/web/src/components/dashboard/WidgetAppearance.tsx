'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { toast } from '@heroui/react'
import {
  Check, ChevronRight, CircleAlert, Loader2, Lock, Monitor,
  Moon, Plus, Smartphone, Sun, X,
} from 'lucide-react'
import {
  WIDGET_LOCALES, WIDGET_POSITIONS, WIDGET_THEMES,
  MAX_WELCOME_MESSAGE_CHARS, MAX_WIDGET_COPY_CHARS, MAX_WIDGET_PATH_RULES,
  isWidgetHexColor, isWidgetPathRule, normalizeWidgetHexColor,
  widgetContrastRatio,
  widgetVisibleOnPath, type WidgetAppearance as Appearance, type WidgetContentLocale,
  type WidgetPosition,
} from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { AppSelect } from '@/components/ui/AppSelect'
import { AppSwitch } from '@/components/ui/AppSwitch'
import { AppTabs } from '@/components/ui/AppTabs'
import { errorText, input, label } from './ui'

type SettingsTab = 'appearance' | 'content' | 'behavior' | 'security'
type PreviewScenario = 'welcome' | 'markdown' | 'handoff' | 'error' | 'long' | 'streaming'
type FieldErrorKey =
  | 'widgetColor' | 'welcomeMessage' | 'headerTitle' | 'statusText'
  | 'inputPlaceholder' | 'launcherGreeting' | 'privacyNotice'
  | 'privacyPolicyURL' | 'verticalOffset' | 'horizontalOffset'
  | 'autoOpenDelaySeconds' | 'launcherGreetingDelaySeconds'
  | 'persistenceDays' | 'devices' | 'includePaths' | 'excludePaths'
  | 'allowedDomains'

const DOMAIN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const fieldLabel: CSSProperties = { display: 'block', marginBottom: 6, fontSize: 12.5, color: 'var(--ink-mute)' }
const help: CSSProperties = { margin: '5px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-faint)', textWrap: 'pretty' }
const group: CSSProperties = { marginBottom: 16 }

const FIELD_TARGETS: Record<FieldErrorKey, { tab: SettingsTab; id: string }> = {
  widgetColor: { tab: 'appearance', id: 'w-color-hex' },
  verticalOffset: { tab: 'appearance', id: 'w-offset-y' },
  horizontalOffset: { tab: 'appearance', id: 'w-offset-x' },
  welcomeMessage: { tab: 'content', id: 'w-welcome' },
  headerTitle: { tab: 'content', id: 'w-title' },
  statusText: { tab: 'content', id: 'w-status' },
  inputPlaceholder: { tab: 'content', id: 'w-placeholder' },
  launcherGreeting: { tab: 'content', id: 'w-greeting' },
  autoOpenDelaySeconds: { tab: 'behavior', id: 'w-auto-open' },
  launcherGreetingDelaySeconds: { tab: 'behavior', id: 'w-greeting-delay' },
  persistenceDays: { tab: 'behavior', id: 'w-days' },
  devices: { tab: 'behavior', id: 'w-desktop' },
  includePaths: { tab: 'behavior', id: 'w-include' },
  excludePaths: { tab: 'behavior', id: 'w-exclude' },
  allowedDomains: { tab: 'security', id: 'w-domain' },
  privacyPolicyURL: { tab: 'security', id: 'w-privacy-url' },
  privacyNotice: { tab: 'security', id: 'w-privacy-notice' },
}

function validDomain(value: string): boolean {
  return value === 'localhost' || DOMAIN.test(value)
}

function validateAppearance(draft: Appearance): Partial<Record<FieldErrorKey, string>> {
  const errors: Partial<Record<FieldErrorKey, string>> = {}
  if (!isWidgetHexColor(draft.widgetColor)) errors.widgetColor = 'Use a hex colour such as #6366f1.'
  if (!draft.welcomeMessage.trim()) errors.welcomeMessage = 'Add a welcome message.'
  else if (draft.welcomeMessage.length > MAX_WELCOME_MESSAGE_CHARS) errors.welcomeMessage = `Keep this under ${MAX_WELCOME_MESSAGE_CHARS} characters.`

  const copyFields: Array<[FieldErrorKey, string]> = [
    ['headerTitle', draft.headerTitle], ['statusText', draft.statusText],
    ['inputPlaceholder', draft.inputPlaceholder], ['launcherGreeting', draft.launcherGreeting],
    ['privacyNotice', draft.privacyNotice],
  ]
  for (const [key, value] of copyFields) {
    if (value.length > MAX_WIDGET_COPY_CHARS) errors[key] = `Keep this under ${MAX_WIDGET_COPY_CHARS} characters.`
  }

  if (draft.privacyPolicyURL) {
    try {
      const url = new URL(draft.privacyPolicyURL)
      if (!['http:', 'https:'].includes(url.protocol)) errors.privacyPolicyURL = 'Use an HTTP or HTTPS URL.'
    } catch { errors.privacyPolicyURL = 'Enter a complete URL, including https://.' }
  }

  const bounded = (key: FieldErrorKey, value: number, min: number, max: number, unit: string) => {
    if (!Number.isFinite(value) || value < min || value > max) errors[key] = `Choose ${min}–${max} ${unit}.`
  }
  bounded('verticalOffset', draft.verticalOffset, 8, 96, 'pixels')
  bounded('horizontalOffset', draft.horizontalOffset, 8, 96, 'pixels')
  bounded('autoOpenDelaySeconds', draft.autoOpenDelaySeconds, 0, 60, 'seconds')
  bounded('launcherGreetingDelaySeconds', draft.launcherGreetingDelaySeconds, 0, 60, 'seconds')
  if (draft.conversationPersistence === 'visitor') bounded('persistenceDays', draft.persistenceDays, 1, 30, 'days')
  if (!draft.showOnDesktop && !draft.showOnMobile) errors.devices = 'Choose at least one device, or pause the widget instead.'

  for (const [key, rules] of [['includePaths', draft.includePaths], ['excludePaths', draft.excludePaths]] as const) {
    if (rules.length > MAX_WIDGET_PATH_RULES) errors[key] = `Use no more than ${MAX_WIDGET_PATH_RULES} patterns.`
    else if (rules.some((rule) => !isWidgetPathRule(rule))) errors[key] = 'Patterns must begin with / and may use * or ? wildcards.'
  }
  if (draft.allowedDomains.some((domain) => !validDomain(domain))) errors.allowedDomains = 'Use hostnames such as example.com or *.example.com.'
  return errors
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null
  return <p id={id} role="alert" style={{ ...errorText, marginTop: 6 }}>{children}</p>
}

function Toggle({ id, checked, onChange, title, description, disabled = false }: { id?: string; checked: boolean; onChange: (checked: boolean) => void; title: string; description?: string; disabled?: boolean }) {
  return <AppSwitch id={id} checked={checked} disabled={disabled} onChange={onChange} label={title} description={description} />
}

function Disclosure({ title, forceOpen = false, children }: { title: string; forceOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details open={open || forceOpen} onToggle={(event) => setOpen(event.currentTarget.open)} style={{ marginTop: 14, borderRadius: 12, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)', overflow: 'hidden' }}>
    <summary style={{ minHeight: 44, padding: '0 13px', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600 }}>{title}</summary>
    <div style={{ padding: '4px 13px 2px' }}>{children}</div>
  </details>
}

function PathRulesInput({ id, value, onChange, placeholder, error }: { id: string; value: string[]; onChange: (value: string[]) => void; placeholder: string; error?: string }) {
  const [entry, setEntry] = useState('')
  const [entryError, setEntryError] = useState('')

  function add() {
    const rule = entry.trim()
    if (!rule || value.includes(rule)) return
    if (!isWidgetPathRule(rule)) { setEntryError('Start with / and use only URL path characters, * or ?.'); return }
    if (value.length >= MAX_WIDGET_PATH_RULES) { setEntryError(`Up to ${MAX_WIDGET_PATH_RULES} patterns are allowed.`); return }
    onChange([...value, rule]); setEntry(''); setEntryError('')
  }

  return <div>
    <div style={{ display: 'flex', gap: 7 }}>
      <input id={id} value={entry} onChange={(event) => { setEntry(event.target.value); setEntryError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }} placeholder={placeholder} aria-invalid={Boolean(entryError || error)} aria-describedby={`${id}-help ${id}-error`} style={{ ...input, padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
      <button type="button" onClick={add} aria-label="Add path pattern" className="btn btn-ghost" style={{ width: 44, height: 44, padding: 0, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Plus size={14} /></button>
    </div>
    <FieldError id={`${id}-error`}>{entryError || error}</FieldError>
    {value.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{value.map((rule) => <span key={rule} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 38, padding: '0 2px 0 10px', borderRadius: 999, background: 'var(--panel-2)', color: 'var(--ink-dim)', font: '11px var(--font-mono)' }}>{rule}<button type="button" aria-label={`Remove ${rule}`} onClick={() => onChange(value.filter((item) => item !== rule))} className="widget-chip-remove"><X size={11} /></button></span>)}</div>}
  </div>
}

function Preview({ appearance, agentName, agentPhotoURL }: { appearance: Appearance; agentName: string; agentPhotoURL: string | null }) {
  const [mobile, setMobile] = useState(false)
  const [scenario, setScenario] = useState<PreviewScenario>('welcome')
  const [autoDark, setAutoDark] = useState(false)

  const previewConfig = useMemo(() => ({
    ...appearance,
    theme: appearance.theme === 'auto' ? (autoDark ? 'dark' : 'light') : appearance.theme,
    showOnDesktop: true,
    showOnMobile: true,
    includePaths: [],
    excludePaths: [],
    agentName,
    agentPhotoURL,
  }), [appearance, autoDark, agentName, agentPhotoURL])
  const encodedConfig = encodeURIComponent(JSON.stringify(previewConfig)).replace(/'/g, '%27')
  const localWidget = process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL
  const widgetScript = process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL ?? (localWidget ? 'http://localhost:5173/dist/widget.js' : 'https://cdn.ayooda.live/widget.js')
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><script>const s=document.createElement('script');s.src=${JSON.stringify(widgetScript)};s.onload=()=>document.body.dataset.widgetScript='loaded';s.onerror=()=>document.body.dataset.widgetScript='failed';s.setAttribute('data-preview-config',decodeURIComponent('${encodedConfig}'));s.setAttribute('data-preview-scenario',${JSON.stringify(scenario)});document.body.appendChild(s);<\/script></body></html>`
  const scale = mobile ? 1 : .7

  return <div style={{ position: 'sticky', top: 18 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-mute)' }}>Interactive production preview</p>
      <div style={{ display: 'flex', gap: 4 }}>
        {appearance.theme === 'auto' && <><button type="button" aria-label="Preview light theme" aria-pressed={!autoDark} onClick={() => setAutoDark(false)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: !autoDark ? 'var(--control-selected-text)' : 'var(--ink-mute)', background: !autoDark ? 'var(--control-selected)' : undefined }}><Sun size={14} /></button><button type="button" aria-label="Preview dark theme" aria-pressed={autoDark} onClick={() => setAutoDark(true)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: autoDark ? 'var(--control-selected-text)' : 'var(--ink-mute)', background: autoDark ? 'var(--control-selected)' : undefined }}><Moon size={14} /></button></>}
        <button type="button" aria-label="Desktop preview" aria-pressed={!mobile} onClick={() => setMobile(false)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: !mobile ? 'var(--control-selected-text)' : 'var(--ink-mute)', background: !mobile ? 'var(--control-selected)' : undefined }}><Monitor size={14} /></button>
        <button type="button" aria-label="Mobile preview" aria-pressed={mobile} onClick={() => setMobile(true)} className="btn btn-ghost" style={{ width: 40, height: 40, padding: 0, display: 'grid', placeItems: 'center', color: mobile ? 'var(--control-selected-text)' : 'var(--ink-mute)', background: mobile ? 'var(--control-selected)' : undefined }}><Smartphone size={14} /></button>
      </div>
    </div>
    <div className="widget-preview-scenarios" style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto' }}>{(['welcome', 'markdown', 'handoff', 'error', 'long', 'streaming'] as const).map((item) => <button key={item} type="button" aria-pressed={scenario === item} onClick={() => setScenario(item)} style={{ minHeight: 40, padding: '0 11px', borderRadius: 999, border: 0, background: scenario === item ? 'var(--control-selected)' : 'var(--bg-2)', color: scenario === item ? 'var(--control-selected-text)' : 'var(--ink-mute)', fontSize: 11.5, textTransform: 'capitalize', cursor: 'pointer', transitionProperty: 'background-color, color, scale', transitionDuration: '150ms' }}>{item}</button>)}</div>
    <div style={{ position: 'relative', height: 560, borderRadius: 16, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.07), 0 4px 14px rgba(0,0,0,.06)', overflow: 'hidden' }}>
      <iframe key={`${scenario}-${JSON.stringify(previewConfig)}`} title="Interactive widget preview" sandbox="allow-scripts allow-popups" srcDoc={srcDoc} style={{ width: mobile ? '100%' : `${100 / scale}%`, height: mobile ? '100%' : `${560 / scale}px`, border: 0, transform: mobile ? undefined : `scale(${scale})`, transformOrigin: appearance.widgetPosition === 'bottom-left' ? 'bottom left' : 'bottom right', position: 'absolute', inset: 0 }} />
    </div>
    <p style={{ ...help, marginTop: 8 }}>Uses the production widget renderer. Preview messages remain local and are not sent to your agent.</p>
  </div>
}

export default function WidgetAppearance({ agentId, agentName, agentPhotoURL, initial, observedDomains = [], brandingLocked, onSaved }: { agentId: string; agentName: string; agentPhotoURL: string | null; initial: Appearance; observedDomains?: string[]; brandingLocked: boolean; onSaved: (appearance: Appearance) => void }) {
  const [draft, setDraft] = useState<Appearance>(initial)
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [domainEntry, setDomainEntry] = useState('')
  const [domainError, setDomainError] = useState('')
  const [testPath, setTestPath] = useState('/pricing')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const errors = useMemo(() => validateAppearance(draft), [draft])
  const errorEntries = Object.entries(errors) as Array<[FieldErrorKey, string]>
  const validColor = !errors.widgetColor
  const canSave = dirty && errorEntries.length === 0
  const contrast = useMemo(() => validColor ? Math.max(widgetContrastRatio(draft.widgetColor, '#fff'), widgetContrastRatio(draft.widgetColor, '#18181b')) : 0, [draft.widgetColor, validColor])
  const pathVisible = testPath.startsWith('/') && widgetVisibleOnPath(testPath, draft.includePaths, draft.excludePaths)
  const suggestedDomains = [...new Set(observedDomains.map((domain) => domain.toLowerCase()))].filter((domain) => validDomain(domain) && !draft.allowedDomains.includes(domain))

  useEffect(() => {
    const section = new URL(window.location.href).searchParams.get('widgetSection') as SettingsTab | null
    if (section && ['appearance', 'content', 'behavior', 'security'].includes(section)) setActiveTab(section)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const linkClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]')
      if (!anchor || !document.contains(anchor)) return
      if (!window.confirm('You have unsaved widget settings. Leave without saving?')) {
        event.preventDefault(); event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', linkClick, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', linkClick, true) }
  }, [dirty])

  async function save() {
    if (errorEntries.length) {
      const [key] = errorEntries[0]!
      const target = FIELD_TARGETS[key]
      setActiveTab(target.tab)
      requestAnimationFrame(() => document.getElementById(target.id)?.focus())
      return
    }
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await apiRequest(`/agents/${agentId}/channels/web-widget`, { method: 'PUT', body: JSON.stringify(draft) })
      const data = await response.json().catch(() => ({})) as Appearance & { error?: string }
      if (!response.ok) { setError(data.error ?? 'Could not save the widget settings.'); return }
      setDraft(data); onSaved(data); setSaved(true); toast.success('Widget settings saved'); setTimeout(() => setSaved(false), 2500)
    } catch { setError('Could not save the widget settings.') } finally { setSaving(false) }
  }

  function addDomain(raw = domainEntry) {
    const domain = raw.trim().toLowerCase()
    if (!domain || draft.allowedDomains.includes(domain)) return
    if (!validDomain(domain)) { setDomainError('Use a hostname such as example.com or *.example.com, without https:// or a path.'); return }
    setDraft({ ...draft, allowedDomains: [...draft.allowedDomains, domain] }); setDomainEntry(''); setDomainError('')
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [{ id: 'appearance', label: 'Appearance' }, { id: 'content', label: 'Content' }, { id: 'behavior', label: 'Behavior' }, { id: 'security', label: 'Security' }]
  function selectTab(tab: SettingsTab) {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('widgetSection', tab)
    window.history.replaceState(window.history.state, '', url)
  }
  function focusFirstError() {
    const first = errorEntries[0]
    if (!first) return
    const target = FIELD_TARGETS[first[0]]
    selectTab(target.tab)
    requestAnimationFrame(() => document.getElementById(target.id)?.focus())
  }

  return <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start', marginBottom: 14 }}>
      <div><p style={{ ...label, marginBottom: 4 }}>Widget settings</p><p style={{ margin: 0, maxWidth: 520, color: 'var(--ink-mute)', fontSize: 12, lineHeight: 1.5, textWrap: 'pretty' }}>Control what visitors see, where the widget appears, and how conversations behave.</p></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}><span style={{ padding: '4px 9px', borderRadius: 99, background: initial.enabled ? 'rgba(52,211,153,.14)' : 'var(--panel-2)', color: initial.enabled ? 'var(--mint)' : 'var(--ink-mute)', font: '500 10.5px var(--font-mono)' }}>{initial.enabled ? 'Published · enabled' : 'Published · paused'}</span>{dirty && <span style={{ padding: '4px 9px', borderRadius: 99, background: 'rgba(245,158,11,.11)', color: '#d97706', font: '500 10.5px var(--font-mono)' }}>Unsaved changes</span>}</div>
    </div>
    <div className="widget-settings-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(260px, .95fr)', gap: 24, alignItems: 'start' }}>
      <AppTabs tabs={tabs} selectedKey={activeTab} onSelectionChange={(key) => selectTab(key as SettingsTab)} ariaLabel="Widget settings">
        {activeTab === 'appearance' && <AppearanceSettings draft={draft} setDraft={setDraft} errors={errors} validColor={validColor} contrast={contrast} brandingLocked={brandingLocked} />}
        {activeTab === 'content' && <ContentSettings draft={draft} setDraft={setDraft} errors={errors} agentId={agentId} agentName={agentName} />}
        {activeTab === 'behavior' && <BehaviorSettings draft={draft} setDraft={setDraft} errors={errors} testPath={testPath} setTestPath={setTestPath} pathVisible={pathVisible} />}
        {activeTab === 'security' && <SecuritySettings draft={draft} setDraft={setDraft} errors={errors} domainEntry={domainEntry} setDomainEntry={setDomainEntry} domainError={domainError} setDomainError={setDomainError} suggestedDomains={suggestedDomains} addDomain={addDomain} />}
      </AppTabs>
      <Preview appearance={draft} agentName={agentName} agentPhotoURL={agentPhotoURL} />
    </div>
    <div aria-live="polite">{error && <p style={{ ...errorText, marginTop: 14 }}>{error}</p>}{errorEntries.length > 0 && dirty && <p style={{ ...errorText, marginTop: 14 }}>{errorEntries.length === 1 ? errorEntries[0]![1] : `Fix ${errorEntries.length} highlighted settings before saving.`}</p>}</div>
    <div className="widget-settings-actions" style={{ position: 'sticky', bottom: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, padding: '12px 0', background: 'linear-gradient(transparent, var(--panel) 28%)' }}><button type="button" onClick={() => void save()} disabled={!canSave || saving} className="btn btn-primary widget-settings-save" aria-describedby={!canSave && dirty ? 'widget-save-reason' : undefined} style={{ minHeight: 44, padding: '0 16px', borderRadius: 9, opacity: !canSave || saving ? .5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : saved ? <><Check size={13} /> Saved</> : 'Save widget settings'}</button>{dirty && errorEntries.length > 0 && <button type="button" onClick={focusFirstError} className="btn btn-ghost widget-settings-review" style={{ minHeight: 44, padding: '0 14px' }}>Review issues</button>}{dirty && !saving && !saved && <button type="button" onClick={() => { setDraft(initial); setError(''); setDomainError('') }} className="btn btn-ghost widget-settings-reset" style={{ minHeight: 44, padding: '0 14px' }}>Reset</button>}<Link href={`/dashboard/agents/${agentId}/usage`} className="widget-settings-usage" style={{ marginLeft: 'auto', minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-mute)', fontSize: 11.5, textDecoration: 'none' }}>View widget usage <ChevronRight size={12} /></Link></div>
    {!canSave && dirty && errorEntries.length > 0 && <span id="widget-save-reason" className="sr-only">Fix the highlighted settings before saving.</span>}
  </div>
}

type SettingsProps = { draft: Appearance; setDraft: (draft: Appearance) => void; errors: Partial<Record<FieldErrorKey, string>> }

function AppearanceSettings({ draft, setDraft, errors, validColor, contrast, brandingLocked }: SettingsProps & { validColor: boolean; contrast: number; brandingLocked: boolean }) {
  return <>
    <div style={group}><label htmlFor="w-color" style={fieldLabel}>Brand colour</label><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><input id="w-color" type="color" value={normalizeWidgetHexColor(draft.widgetColor) ?? '#6366f1'} onChange={(event) => setDraft({ ...draft, widgetColor: event.target.value })} style={{ width: 44, height: 40, padding: 3, borderRadius: 9, border: '1px solid var(--line-2)', background: 'var(--bg-2)' }} /><input id="w-color-hex" aria-label="Colour hex value" value={draft.widgetColor} aria-invalid={!validColor} aria-describedby="w-color-error" onChange={(event) => setDraft({ ...draft, widgetColor: event.target.value })} style={{ ...input, width: 120, padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 13 }} /><span style={{ padding: '4px 8px', borderRadius: 99, background: validColor ? 'rgba(52,211,153,.14)' : 'rgba(239,68,68,.12)', color: validColor ? 'var(--mint)' : 'var(--danger)', font: '500 10.5px var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{validColor ? `${contrast.toFixed(1)}:1 · Accessible` : 'Invalid'}</span></div><FieldError id="w-color-error">{errors.widgetColor}</FieldError></div>
    <div style={group}><label style={fieldLabel}>Panel theme</label><AppSelect ariaLabel="Panel theme" value={draft.theme} onChange={(value) => setDraft({ ...draft, theme: value as Appearance['theme'] })} options={WIDGET_THEMES.map((theme) => ({ value: theme, label: theme === 'auto' ? 'Match visitor device' : `${theme[0]!.toUpperCase()}${theme.slice(1)}` }))} /></div>
    <div className="widget-two-column-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div style={group}><label style={fieldLabel}>Position</label><AppSelect ariaLabel="Widget position" value={draft.widgetPosition} onChange={(value) => setDraft({ ...draft, widgetPosition: value as WidgetPosition })} options={WIDGET_POSITIONS.map((position) => ({ value: position.id, label: position.label }))} /></div><div style={group}><label htmlFor="w-offset-y" style={fieldLabel}>Bottom offset</label><input id="w-offset-y" type="number" min={8} max={96} value={draft.verticalOffset} aria-invalid={Boolean(errors.verticalOffset)} aria-describedby="w-offset-y-error" onChange={(event) => setDraft({ ...draft, verticalOffset: Number(event.target.value) })} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-offset-y-error">{errors.verticalOffset}</FieldError></div></div>
    <div style={group}><label htmlFor="w-offset-x" style={fieldLabel}>Side offset</label><input id="w-offset-x" type="number" min={8} max={96} value={draft.horizontalOffset} aria-invalid={Boolean(errors.horizontalOffset)} aria-describedby="w-offset-x-error" onChange={(event) => setDraft({ ...draft, horizontalOffset: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /><p style={help}>Useful around cookie banners and floating controls.</p><FieldError id="w-offset-x-error">{errors.horizontalOffset}</FieldError></div>
    <Toggle checked={draft.showBranding} disabled={brandingLocked} onChange={(checked) => setDraft({ ...draft, showBranding: checked })} title="Show “Powered by Ayooda”" description={brandingLocked ? 'Removing attribution is available on Core and above.' : 'Turn this off to run the widget unbranded.'} />{brandingLocked && <p style={{ ...help, marginLeft: 25 }}><Lock size={10} /> <Link href="/dashboard/billing" style={{ color: 'var(--accent-text)' }}>Upgrade to unlock</Link></p>}
  </>
}

function ContentSettings({ draft, setDraft, errors, agentId, agentName }: SettingsProps & { agentId: string; agentName: string }) {
  return <>
    <div style={group}><label htmlFor="w-title" style={fieldLabel}>Header title</label><input id="w-title" maxLength={MAX_WIDGET_COPY_CHARS} value={draft.headerTitle} aria-invalid={Boolean(errors.headerTitle)} aria-describedby="w-title-help w-title-error" onChange={(event) => setDraft({ ...draft, headerTitle: event.target.value })} placeholder={agentName} style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><p id="w-title-help" style={help}>Leave blank to use the agent name from <Link href={`/dashboard/agents/${agentId}`} style={{ color: 'var(--accent-text)' }}>Info settings</Link>.</p><FieldError id="w-title-error">{errors.headerTitle}</FieldError></div>
    <div style={group}><label htmlFor="w-status" style={fieldLabel}>Header subtitle</label><input id="w-status" maxLength={MAX_WIDGET_COPY_CHARS} value={draft.statusText} aria-invalid={Boolean(errors.statusText)} aria-describedby="w-status-error" onChange={(event) => setDraft({ ...draft, statusText: event.target.value })} placeholder="Online" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-status-error">{errors.statusText}</FieldError></div>
    <div style={group}><label htmlFor="w-welcome" style={fieldLabel}>Welcome message</label><textarea id="w-welcome" value={draft.welcomeMessage} aria-invalid={Boolean(errors.welcomeMessage)} aria-describedby="w-welcome-count w-welcome-error" onChange={(event) => setDraft({ ...draft, welcomeMessage: event.target.value })} style={{ ...input, minHeight: 76, resize: 'vertical', padding: '9px 10px', fontSize: 13 }} /><p id="w-welcome-count" style={{ ...help, color: errors.welcomeMessage ? 'var(--danger)' : 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}>{draft.welcomeMessage.length}/{MAX_WELCOME_MESSAGE_CHARS}</p><FieldError id="w-welcome-error">{errors.welcomeMessage}</FieldError></div>
    <div style={group}><label htmlFor="w-placeholder" style={fieldLabel}>Message placeholder</label><input id="w-placeholder" maxLength={MAX_WIDGET_COPY_CHARS} value={draft.inputPlaceholder} aria-invalid={Boolean(errors.inputPlaceholder)} aria-describedby="w-placeholder-error" onChange={(event) => setDraft({ ...draft, inputPlaceholder: event.target.value })} placeholder="Compose your message…" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-placeholder-error">{errors.inputPlaceholder}</FieldError></div>
    <div style={group}><label htmlFor="w-greeting" style={fieldLabel}>Launcher greeting</label><input id="w-greeting" maxLength={MAX_WIDGET_COPY_CHARS} value={draft.launcherGreeting} aria-invalid={Boolean(errors.launcherGreeting)} aria-describedby="w-greeting-help w-greeting-error" onChange={(event) => setDraft({ ...draft, launcherGreeting: event.target.value })} placeholder="Need help? Chat with us." style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><p id="w-greeting-help" style={help}>Optional. Its delay appears in Behavior after you add text.</p><FieldError id="w-greeting-error">{errors.launcherGreeting}</FieldError></div>
    <div style={group}><label style={fieldLabel}>Interface language</label><AppSelect ariaLabel="Interface language" value={draft.locale} onChange={(value) => setDraft({ ...draft, locale: value as Appearance['locale'] })} options={WIDGET_LOCALES.map((locale) => ({ value: locale, label: ({ auto: 'Automatic', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ar: 'العربية' } as const)[locale] }))} /><p style={help}>Built-in controls are translated. Your custom text stays exactly as entered.</p></div>
    <LocalizedContentSettings draft={draft} setDraft={setDraft} />
  </>
}

function LocalizedContentSettings({ draft, setDraft }: Pick<SettingsProps, 'draft' | 'setDraft'>) {
  const [locale, setLocale] = useState<WidgetContentLocale>('es')
  const values = draft.localizedContent?.[locale] ?? {}
  const names: Record<WidgetContentLocale, string> = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ar: 'العربية' }
  type LocalizedField = 'headerTitle' | 'statusText' | 'welcomeMessage' | 'inputPlaceholder' | 'launcherGreeting' | 'privacyNotice'
  const fields: Array<{ key: LocalizedField; label: string; placeholder: string; max: number }> = [
    { key: 'headerTitle', label: 'Header title', placeholder: draft.headerTitle || 'Use default title', max: MAX_WIDGET_COPY_CHARS },
    { key: 'statusText', label: 'Header subtitle', placeholder: draft.statusText || 'Use translated Online label', max: MAX_WIDGET_COPY_CHARS },
    { key: 'welcomeMessage', label: 'Welcome message', placeholder: draft.welcomeMessage, max: MAX_WELCOME_MESSAGE_CHARS },
    { key: 'inputPlaceholder', label: 'Message placeholder', placeholder: draft.inputPlaceholder || 'Use built-in translation', max: MAX_WIDGET_COPY_CHARS },
    { key: 'launcherGreeting', label: 'Launcher greeting', placeholder: draft.launcherGreeting || 'Use default greeting', max: MAX_WIDGET_COPY_CHARS },
    { key: 'privacyNotice', label: 'Privacy notice', placeholder: draft.privacyNotice || 'Use default privacy notice', max: MAX_WIDGET_COPY_CHARS },
  ]
  function update(key: LocalizedField, value: string) {
    const nextValues = { ...values, [key]: value }
    for (const entry of Object.keys(nextValues) as LocalizedField[]) {
      if (!nextValues[entry]) delete nextValues[entry]
    }
    const localizedContent = { ...(draft.localizedContent ?? {}), [locale]: nextValues }
    if (!Object.keys(nextValues).length) delete localizedContent[locale]
    setDraft({ ...draft, localizedContent })
  }
  return <details style={{ marginTop: 8, borderRadius: 12, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)', overflow: 'hidden' }}>
    <summary style={{ minHeight: 44, padding: '0 13px', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600 }}>Localized custom copy</summary>
    <div style={{ padding: '4px 13px 14px' }}>
      <p style={{ ...help, margin: '0 0 11px' }}>Add optional visitor-language versions. Empty fields fall back to the default copy above.</p>
      <label style={fieldLabel}>Translation language</label>
      <AppSelect ariaLabel="Translation language" value={locale} onChange={(value) => setLocale(value as WidgetContentLocale)} style={{ marginBottom: 13 }} options={Object.entries(names).map(([value, name]) => ({ value, label: name }))} />
      {fields.map((field) => <div key={field.key} style={{ marginBottom: 11 }}><label htmlFor={`w-localized-${field.key}`} style={fieldLabel}>{field.label}</label>{field.key === 'welcomeMessage' || field.key === 'privacyNotice' ? <textarea id={`w-localized-${field.key}`} maxLength={field.max} value={values[field.key] ?? ''} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} style={{ ...input, minHeight: 64, resize: 'vertical', padding: '9px 10px', fontSize: 13 }} /> : <input id={`w-localized-${field.key}`} maxLength={field.max} value={values[field.key] ?? ''} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} style={{ ...input, padding: '9px 10px', fontSize: 13 }} />}</div>)}
    </div>
  </details>
}

function BehaviorSettings({ draft, setDraft, errors, testPath, setTestPath, pathVisible }: SettingsProps & { testPath: string; setTestPath: (path: string) => void; pathVisible: boolean }) {
  return <>
    <Toggle checked={draft.enabled} onChange={(checked) => setDraft({ ...draft, enabled: checked })} title="Widget enabled" description="Pause it without changing the embed code." /><div style={{ height: 1, margin: '8px 0 16px', background: 'var(--line)' }} />
    <Toggle checked={draft.autoOpenDelaySeconds > 0} onChange={(checked) => setDraft({ ...draft, autoOpenDelaySeconds: checked ? 5 : 0 })} title="Auto-open the widget" description="Open the conversation after a short delay." />
    {draft.autoOpenDelaySeconds > 0 && <div style={{ margin: '4px 0 12px 25px' }}><label htmlFor="w-auto-open" style={fieldLabel}>Auto-open delay</label><input id="w-auto-open" type="number" min={1} max={60} value={draft.autoOpenDelaySeconds} aria-invalid={Boolean(errors.autoOpenDelaySeconds)} aria-describedby="w-auto-open-error" onChange={(event) => setDraft({ ...draft, autoOpenDelaySeconds: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-auto-open-error">{errors.autoOpenDelaySeconds}</FieldError><div style={{ marginTop: 8 }}><Toggle checked={draft.autoOpenOncePerSession} onChange={(checked) => setDraft({ ...draft, autoOpenOncePerSession: checked })} title="Only once per session" /></div></div>}
    {draft.launcherGreeting && <div style={group}><label htmlFor="w-greeting-delay" style={fieldLabel}>Launcher greeting delay</label><input id="w-greeting-delay" type="number" min={0} max={60} value={draft.launcherGreetingDelaySeconds} aria-invalid={Boolean(errors.launcherGreetingDelaySeconds)} aria-describedby="w-greeting-delay-help w-greeting-delay-error" onChange={(event) => setDraft({ ...draft, launcherGreetingDelaySeconds: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /><p id="w-greeting-delay-help" style={help}>Seconds after the page loads.</p><FieldError id="w-greeting-delay-error">{errors.launcherGreetingDelaySeconds}</FieldError></div>}
    <div style={{ marginTop: 12 }}><Toggle id="w-desktop" checked={draft.showOnDesktop} onChange={(checked) => setDraft({ ...draft, showOnDesktop: checked })} title="Show on desktop" /><Toggle checked={draft.showOnMobile} onChange={(checked) => setDraft({ ...draft, showOnMobile: checked })} title="Show on mobile" /><FieldError id="w-devices-error">{errors.devices}</FieldError></div>
    <Disclosure title="Advanced behavior" forceOpen={Boolean(errors.includePaths || errors.excludePaths || errors.persistenceDays)}>
    <div style={{ ...group, marginTop: 12 }}><label htmlFor="w-include" style={fieldLabel}>Only show on paths</label><PathRulesInput id="w-include" value={draft.includePaths} onChange={(value) => setDraft({ ...draft, includePaths: value })} placeholder="/pricing or /help/*" error={errors.includePaths} /><p id="w-include-help" style={help}>Empty includes every page. Add one pattern at a time.</p></div>
    <div style={group}><label htmlFor="w-exclude" style={fieldLabel}>Hide on paths</label><PathRulesInput id="w-exclude" value={draft.excludePaths} onChange={(value) => setDraft({ ...draft, excludePaths: value })} placeholder="/checkout/*" error={errors.excludePaths} /><p id="w-exclude-help" style={help}>Hide rules win when a path matches both lists.</p></div>
    <div style={{ ...group, padding: 12, borderRadius: 12, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }}><label htmlFor="w-test-path" style={fieldLabel}>Test a website path</label><input id="w-test-path" value={testPath} onChange={(event) => setTestPath(event.target.value)} placeholder="/pricing" style={{ ...input, padding: '9px 10px', fontFamily: 'var(--font-mono)', fontSize: 12 }} /><p style={{ ...help, color: testPath.startsWith('/') ? (pathVisible ? 'var(--mint)' : '#d97706') : 'var(--danger)' }}>{!testPath.startsWith('/') ? 'Start the path with /.' : pathVisible ? 'The widget will appear on this path.' : 'The widget will be hidden on this path.'}</p></div>
    <div style={group}><label style={fieldLabel}>Conversation memory</label><AppSelect ariaLabel="Conversation memory" value={draft.conversationPersistence} onChange={(value) => setDraft({ ...draft, conversationPersistence: value as Appearance['conversationPersistence'] })} options={[{ value: 'session', label: 'Remember in this browser tab' }, { value: 'visitor', label: 'Remember returning visitors' }, { value: 'fresh', label: 'Always start fresh' }]} />{draft.conversationPersistence === 'visitor' && <p style={help}>Stores a conversation identifier in the visitor’s browser. Mention this in your privacy notice where required.</p>}</div>
    {draft.conversationPersistence === 'visitor' && <div style={group}><label htmlFor="w-days" style={fieldLabel}>Remember for days</label><input id="w-days" type="number" min={1} max={30} value={draft.persistenceDays} aria-invalid={Boolean(errors.persistenceDays)} aria-describedby="w-days-error" onChange={(event) => setDraft({ ...draft, persistenceDays: Number(event.target.value) })} style={{ ...input, maxWidth: 150, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-days-error">{errors.persistenceDays}</FieldError></div>}
    <Toggle checked={draft.soundEnabled} onChange={(checked) => setDraft({ ...draft, soundEnabled: checked })} title="Reply sound" description="Play a subtle sound for replies received while closed." />
    </Disclosure>
  </>
}

function SecuritySettings({ draft, setDraft, errors, domainEntry, setDomainEntry, domainError, setDomainError, suggestedDomains, addDomain }: SettingsProps & { domainEntry: string; setDomainEntry: (value: string) => void; domainError: string; setDomainError: (value: string) => void; suggestedDomains: string[]; addDomain: (domain?: string) => void }) {
  return <>
    <div style={{ marginBottom: 18, padding: 13, borderRadius: 12, background: draft.allowedDomains.length ? 'rgba(52,211,153,.08)' : 'rgba(245,158,11,.09)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }}><p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink)', display: 'flex', gap: 7, alignItems: 'center' }}>{draft.allowedDomains.length ? <Check size={14} style={{ color: 'var(--mint)' }} /> : <CircleAlert size={14} style={{ color: '#d97706' }} />}{draft.allowedDomains.length ? 'Embedding is restricted' : 'Any website can currently embed this widget'}</p></div>
    {suggestedDomains.length > 0 && <div style={{ ...group, padding: 12, borderRadius: 12, background: 'var(--bg-2)', boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }}><p style={{ ...fieldLabel, margin: 0 }}>Detected installation domains</p><p style={help}>Add a detected hostname to the allowlist with one click.</p><div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 9 }}>{suggestedDomains.map((domain) => <button key={domain} type="button" onClick={() => addDomain(domain)} className="btn btn-ghost" style={{ minHeight: 40, padding: '0 11px', font: '11px var(--font-mono)' }}><Plus size={12} /> {domain}</button>)}</div></div>}
    <div style={group}><label htmlFor="w-domain" style={fieldLabel}>Allowed domains</label><div style={{ display: 'flex', gap: 7 }}><input id="w-domain" value={domainEntry} onChange={(event) => { setDomainEntry(event.target.value); setDomainError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDomain() } }} aria-invalid={Boolean(domainError || errors.allowedDomains)} aria-describedby="w-domain-error" placeholder="example.com or *.example.com" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><button type="button" onClick={() => addDomain()} aria-label="Add domain" className="btn btn-ghost" style={{ width: 44, height: 44, padding: 0, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Plus size={14} /></button></div><FieldError id="w-domain-error">{domainError || errors.allowedDomains}</FieldError><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{draft.allowedDomains.map((domain) => <span key={domain} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 38, padding: '0 2px 0 10px', borderRadius: 999, background: 'var(--panel-2)', color: 'var(--ink-dim)', font: '11px var(--font-mono)' }}>{domain}<button type="button" aria-label={`Remove ${domain}`} onClick={() => setDraft({ ...draft, allowedDomains: draft.allowedDomains.filter((item) => item !== domain) })} className="widget-chip-remove"><X size={11} /></button></span>)}</div></div>
    <Disclosure title="Privacy and compliance" forceOpen={Boolean(errors.privacyPolicyURL || errors.privacyNotice)}>
    <div style={group}><label htmlFor="w-privacy-url" style={fieldLabel}>Privacy policy URL</label><input id="w-privacy-url" type="url" value={draft.privacyPolicyURL} aria-invalid={Boolean(errors.privacyPolicyURL)} aria-describedby="w-privacy-url-error" onChange={(event) => setDraft({ ...draft, privacyPolicyURL: event.target.value })} placeholder="https://example.com/privacy" style={{ ...input, padding: '9px 10px', fontSize: 13 }} /><FieldError id="w-privacy-url-error">{errors.privacyPolicyURL}</FieldError></div>
    <div style={group}><label htmlFor="w-privacy-notice" style={fieldLabel}>Privacy notice</label><textarea id="w-privacy-notice" maxLength={MAX_WIDGET_COPY_CHARS} value={draft.privacyNotice} aria-invalid={Boolean(errors.privacyNotice)} aria-describedby="w-privacy-notice-help w-privacy-notice-error" onChange={(event) => setDraft({ ...draft, privacyNotice: event.target.value })} placeholder="Messages may be stored to provide support." style={{ ...input, minHeight: 70, resize: 'vertical', padding: '9px 10px', fontSize: 13 }} /><p id="w-privacy-notice-help" style={help}>Shown in the widget footer beside your privacy-policy link.</p><FieldError id="w-privacy-notice-error">{errors.privacyNotice}</FieldError></div>
    </Disclosure>
  </>
}
