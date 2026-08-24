'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { CheckCircle2, CircleDashed, ExternalLink, KeyRound, Loader2, PackagePlus, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import {
  TOOL_BUNDLES,
  TOOL_TEMPLATES,
  applyTemplate,
  setupFieldsForToolBundle,
  templatesForToolBundle,
  type ToolBundle,
  type ConnectorStatus,
  type ToolDef,
  type ToolMethod,
  type ToolParamType,
  type ToolAuthType,
  type ToolKind,
  type ToolTemplate,
  type ToolBodyEncoding,
} from '@ayooda/shared'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, input, errorText } from '@/components/dashboard/ui'
import styles from './page.module.css'

const row: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 }

interface ParamRow { name: string; type: ToolParamType; description: string; required: boolean }
interface HeaderRow { key: string; value: string }
type BundleState = 'available' | 'partial' | 'installed'
type PickerState =
  | 'gallery'
  | { kind: 'template'; template: ToolTemplate; setup: Record<string, string> }
  | { kind: 'bundle'; bundle: ToolBundle; setup: Record<string, string>; secret: string }
  | null
interface FormState {
  id: string | null
  name: string; description: string; method: ToolMethod; urlTemplate: string
  params: ParamRow[]; headers: HeaderRow[]
  bodyTemplate: string; bodyEncoding: ToolBodyEncoding
  authType: ToolAuthType; headerName: string; secret: string; hasSecret: boolean
  kind: ToolKind; writeEnabled: boolean; enabled: boolean
}

const emptyForm: FormState = {
  id: null, name: '', description: '', method: 'GET', urlTemplate: '',
  params: [], headers: [], authType: 'none', headerName: '', secret: '', hasSecret: false,
  bodyTemplate: '', bodyEncoding: 'json',
  kind: 'read', writeEnabled: false, enabled: true,
}

function installedBundleTemplates(bundle: ToolBundle, tools: ToolDef[]): string[] {
  const templates = templatesForToolBundle(bundle)
  return templates
    .filter((template) => tools.some((tool) => tool.templateId === template.id || tool.name === template.toolName))
    .map((template) => template.id)
}

function bundleState(bundle: ToolBundle, tools: ToolDef[]): BundleState {
  const installed = installedBundleTemplates(bundle, tools).length
  if (installed === 0) return 'available'
  return installed === bundle.templateIds.length ? 'installed' : 'partial'
}

function bundleSecretLabel(bundle: ToolBundle): string | null {
  return templatesForToolBundle(bundle).find((template) => template.auth.type !== 'none')?.secretLabel ?? null
}

export default function AgentToolsPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)

  const [tools, setTools] = useState<ToolDef[]>([])
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [picker, setPicker] = useState<PickerState>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [toolsRes, connectorsRes] = await Promise.all([
        apiRequest(`/agents/${agentId}/tools`),
        apiRequest(`/agents/${agentId}/tools/connectors`),
      ])
      if (toolsRes.ok) { const d = await toolsRes.json() as { tools: ToolDef[] }; setTools(d.tools) }
      if (connectorsRes.ok) { const d = await connectorsRes.json() as { connectors: ConnectorStatus[] }; setConnectors(d.connectors) }
    } finally { setLoading(false) }
  }, [agentId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const providerId = params.get('connector')
    const outcome = params.get('oauth')
    if (!providerId || !outcome) return
    const label = TOOL_BUNDLES.find((bundle) => bundle.id === providerId)?.label ?? 'Provider'
    setNotice(outcome === 'success'
      ? `${label} connected with OAuth. Its missing actions were installed; review write actions before enabling them.`
      : `${label} authorization was not completed. You can try OAuth again or use a private token.`)
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  function startCreate() { setForm({ ...emptyForm }); setError(''); setNotice(''); setTestResult(''); setTestArgs('{}') }
  function chooseTemplate(template: ToolTemplate) {
    setPicker({ kind: 'template', template, setup: Object.fromEntries(template.setupFields.map((f) => [f.key, ''])) })
    setError(''); setNotice('')
  }
  function chooseBundle(bundle: ToolBundle) {
    const connector = connectors.find((item) => item.providerId === bundle.id)
    setPicker({
      kind: 'bundle', bundle,
      setup: Object.fromEntries(setupFieldsForToolBundle(bundle).map((field) => [field.key, connector?.setup[field.key] ?? ''])),
      secret: '',
    })
    setError(''); setNotice('')
  }
  function applyPickedTemplate(p: Extract<PickerState, { kind: 'template' }>) {
    const a = applyTemplate(p.template, p.setup)
    setForm({
      id: null,
      name: a.name, description: a.description, method: a.method, urlTemplate: a.urlTemplate,
      params: a.params.map((x) => ({ ...x })), headers: a.headers.map((x) => ({ ...x })),
      bodyTemplate: a.bodyTemplate ?? '', bodyEncoding: a.bodyEncoding ?? 'json',
      authType: a.auth.type, headerName: a.auth.headerName ?? '', secret: '', hasSecret: false,
      kind: a.kind, writeEnabled: false, enabled: true,
    })
    setPicker(null); setError(''); setTestResult(''); setTestArgs('{}')
  }

  async function installBundle(p: Extract<PickerState, { kind: 'bundle' }>) {
    setSaving(true); setError(''); setNotice('')
    try {
      const res = await apiRequest(`/agents/${agentId}/tools/bundles`, {
        method: 'POST',
        body: JSON.stringify({
          bundleId: p.bundle.id,
          setup: p.setup,
          ...(p.secret ? { secret: p.secret } : { credentialId: p.bundle.id }),
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; installed?: ToolDef[]; skippedTemplateIds?: string[] }
      if (!res.ok) { setError(data.error ?? 'Could not install the connector.'); return }
      const installed = data.installed?.length ?? 0
      setPicker(null)
      setNotice(installed
        ? `${p.bundle.label} connected with ${installed} new action${installed === 1 ? '' : 's'}. Review write actions before enabling them.`
        : `${p.bundle.label} is already fully installed.`)
      await load()
    } finally { setSaving(false) }
  }

  async function startOAuth(p: Extract<PickerState, { kind: 'bundle' }>) {
    setSaving(true); setError(''); setNotice('')
    try {
      const res = await apiRequest(`/agents/${agentId}/tools/connectors/${p.bundle.id}/oauth/start`, {
        method: 'POST', body: JSON.stringify({ setup: p.setup }),
      })
      const data = await res.json().catch(() => ({})) as { authorizeUrl?: string; error?: string }
      if (!res.ok || !data.authorizeUrl) { setError(data.error ?? 'Could not start provider authorization.'); return }
      window.location.assign(data.authorizeUrl)
    } finally { setSaving(false) }
  }
  function startEdit(t: ToolDef) {
    setForm({
      id: t.id, name: t.name, description: t.description, method: t.method, urlTemplate: t.urlTemplate,
      params: t.params.map((p) => ({ ...p })), headers: t.headers.map((h) => ({ ...h })),
      bodyTemplate: t.bodyTemplate ?? '', bodyEncoding: t.bodyEncoding ?? 'json',
      authType: t.auth.type, headerName: t.auth.headerName ?? '', secret: '', hasSecret: t.hasSecret,
      kind: t.kind, writeEnabled: t.writeEnabled, enabled: t.enabled,
    })
    setError(''); setNotice(''); setTestResult(''); setTestArgs('{}')
  }

  function payload(f: FormState) {
    return {
      name: f.name.trim(), description: f.description.trim(), method: f.method, urlTemplate: f.urlTemplate.trim(),
      params: f.params, headers: f.headers.filter((h) => h.key.trim()),
      ...(f.bodyTemplate.trim() ? { bodyTemplate: f.bodyTemplate.trim(), bodyEncoding: f.bodyEncoding } : {}),
      auth: { type: f.authType, ...(f.authType === 'header' ? { headerName: f.headerName.trim() } : {}), ...(f.secret ? { secret: f.secret } : {}) },
      kind: f.kind, writeEnabled: f.kind === 'write' ? f.writeEnabled : false, enabled: f.enabled,
    }
  }

  async function save() {
    if (!form) return
    setSaving(true); setError('')
    try {
      const res = form.id
        ? await apiRequest(`/agents/${agentId}/tools/${form.id}`, { method: 'PUT', body: JSON.stringify(payload(form)) })
        : await apiRequest(`/agents/${agentId}/tools`, { method: 'POST', body: JSON.stringify(payload(form)) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the tool'); return }
      setForm(null); await load()
    } finally { setSaving(false) }
  }

  async function runTest() {
    if (!form?.id) { setTestResult('Save the tool before testing.'); return }
    if (form.kind === 'write' && !window.confirm('This sends a real write request to the provider. Continue?')) return
    setTesting(true); setTestResult('')
    let args: unknown = {}
    try { args = JSON.parse(testArgs || '{}') } catch { setTestResult('Sample args must be valid JSON.'); setTesting(false); return }
    try {
      const res = await apiRequest(`/agents/${agentId}/tools/${form.id}/test`, { method: 'POST', body: JSON.stringify({ args }) })
      const d = await res.json().catch(() => ({}))
      setTestResult(JSON.stringify(d, null, 2))
    } finally { setTesting(false) }
  }

  async function remove(id: string) {
    setBusyId(id)
    try { await apiRequest(`/agents/${agentId}/tools/${id}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  if (loading) return <Loading />

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
          Let this agent call your APIs — look up orders, check inventory, update records.
        </p>
        {!form && !picker && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" onClick={() => { setPicker('gallery'); setError(''); setNotice('') }} className="btn btn-ghost" style={{ minHeight: 40, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>Connect provider</button>
            <button type="button" onClick={startCreate} className="btn btn-primary" style={{ minHeight: 40, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}><Plus size={14} /> New tool</button>
          </div>
        )}
      </div>

      {notice && <p role="status" className={styles.notice}>{notice}</p>}

      {!form && !picker && (
        <div style={card}>
          <p style={label}>This agent&apos;s tools</p>
          {tools.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No tools yet. Create one to give this agent an action.</p>}
          {tools.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{t.name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{t.method}</span></p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.urlTemplate}</p>
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, background: 'var(--bg-2)', color: t.kind === 'write' ? 'var(--accent)' : 'var(--ink-mute)' }}>{t.kind}{t.kind === 'write' && !t.writeEnabled ? ' · off' : ''}</span>
              {!t.enabled && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>disabled</span>}
              <button type="button" onClick={() => startEdit(t)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              <button type="button" onClick={() => void remove(t.id)} disabled={busyId === t.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>
                {busyId === t.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {picker === 'gallery' && (
        <div style={card}>
          <div className={styles.galleryHeader}>
            <div>
              <p style={label}>Connect a provider</p>
              <p>Install a complete action set with one setup and credential step.</p>
            </div>
            <button type="button" onClick={() => setPicker(null)} className="btn btn-ghost" style={{ minHeight: 40, borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Cancel</button>
          </div>
          <div className={styles.bundleGrid}>
            {TOOL_BUNDLES.map((bundle) => {
              const state = bundleState(bundle, tools)
              const installed = installedBundleTemplates(bundle, tools).length
              const connector = connectors.find((item) => item.providerId === bundle.id)
              return (
                <button key={bundle.id} type="button" onClick={() => chooseBundle(bundle)} className={styles.bundleCard}>
                  <span className={styles.bundleCardTop}>
                    <span className={styles.providerIcon}><PackagePlus size={16} /></span>
                    <span className={`${styles.bundleStatus} ${connector?.connected || state === 'installed' ? styles.bundleStatusInstalled : state === 'partial' ? styles.bundleStatusPartial : ''}`}>
                      {connector?.connected || state === 'installed' ? <CheckCircle2 size={12} /> : <CircleDashed size={12} />}
                      {connector?.connected ? `Connected · ${connector.authMode}` : state === 'installed' ? 'Installed' : state === 'partial' ? 'Partial' : 'Available'}
                    </span>
                  </span>
                  <strong>{bundle.label}</strong>
                  <span className={styles.bundleDescription}>{bundle.description}</span>
                  <span className={styles.bundleMeta}>{installed}/{bundle.templateIds.length} actions installed · {bundle.category}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.individualHeader}>
            <p style={label}>Individual action templates</p>
            <p>Use one action as a starting point for a custom setup.</p>
          </div>
          <div className={styles.templateGrid}>
            {TOOL_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => chooseTemplate(t)} className={styles.templateCard}>
                <div className={styles.templateTitle}>
                  <span>{t.label}</span>
                  <span>{t.category}</span>
                </div>
                <p>{t.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {picker && picker !== 'gallery' && picker.kind === 'template' && (
        <div style={card}>
          <p style={label}>{picker.template.label}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16 }}>{picker.template.description}</p>
          {picker.template.setupFields.map((f) => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input
                placeholder={f.placeholder}
                value={picker.setup[f.key] ?? ''}
                onChange={(e) => setPicker({ ...picker, setup: { ...picker.setup, [f.key]: e.target.value } })}
                style={input}
              />
              {f.help && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>{f.help}</p>}
            </div>
          ))}
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 8 }}>You&apos;ll add the secret next: <strong style={{ color: 'var(--ink-dim)' }}>{picker.template.secretLabel}</strong></p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => applyPickedTemplate(picker)}
              disabled={picker.template.setupFields.some((f) => !picker.setup[f.key]?.trim())}
              className="btn btn-primary"
              style={{ minHeight: 40, borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: picker.template.setupFields.some((f) => !picker.setup[f.key]?.trim()) ? 0.5 : 1 }}
            >
              Continue
            </button>
            <button type="button" onClick={() => setPicker('gallery')} className="btn btn-ghost" style={{ minHeight: 40, borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Back</button>
          </div>
        </div>
      )}

      {picker && picker !== 'gallery' && picker.kind === 'bundle' && (() => {
        const fields = setupFieldsForToolBundle(picker.bundle)
        const secretLabel = bundleSecretLabel(picker.bundle)
        const installed = installedBundleTemplates(picker.bundle, tools).length
        const connector = connectors.find((item) => item.providerId === picker.bundle.id)
        const incompleteSetup = fields.some((field) => !picker.setup[field.key]?.trim())
        const incomplete = incompleteSetup || (!!secretLabel && !picker.secret.trim() && !connector?.connected)
        return (
          <div style={card}>
            <div className={styles.setupHeader}>
              <span className={styles.providerIcon}><PackagePlus size={17} /></span>
              <div>
                <p style={label}>Connect {picker.bundle.label}</p>
                <p>{picker.bundle.description}</p>
              </div>
            </div>

            {installed > 0 && <p className={styles.partialNotice}>{installed} of {picker.bundle.templateIds.length} actions already exist. Only missing actions will be installed.</p>}

            <div className={styles.actionPreview}>
              {templatesForToolBundle(picker.bundle).map((template) => {
                const exists = tools.some((tool) => tool.templateId === template.id || tool.name === template.toolName)
                return (
                  <div key={template.id}>
                    <span className={exists ? styles.actionCheckInstalled : styles.actionCheck}><CheckCircle2 size={14} /></span>
                    <span><strong>{template.label.replace(`${picker.bundle.label} — `, '')}</strong><small>{template.kind === 'write' ? 'Write · installed off' : 'Read · ready immediately'}</small></span>
                  </div>
                )
              })}
            </div>

            <div className={styles.setupFields}>
              {fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    placeholder={field.placeholder}
                    value={picker.setup[field.key] ?? ''}
                    onChange={(event) => setPicker({ ...picker, setup: { ...picker.setup, [field.key]: event.target.value } })}
                    style={input}
                  />
                  {field.help && <small>{field.help}</small>}
                </label>
              ))}
            </div>

            {secretLabel && (
              <div className={styles.credentialPanel}>
                <div className={styles.credentialSummary}>
                  <span className={connector?.connected ? styles.credentialIconConnected : styles.credentialIcon}><KeyRound size={16} /></span>
                  <span>
                    <strong>{connector?.connected ? `Workspace credential connected with ${connector.authMode === 'oauth' ? 'OAuth' : 'a private token'}` : 'Connect one workspace credential'}</strong>
                    <small>Every {picker.bundle.label} action references this encrypted record, so replacing it updates all agents that use it.</small>
                  </span>
                </div>
                {connector?.oauthAvailable && (
                  <button type="button" className={styles.oauthButton} onClick={() => void startOAuth(picker)} disabled={saving || incompleteSetup}>
                    <ExternalLink size={14} /> {connector.connected && connector.authMode === 'oauth' ? 'Reconnect OAuth' : `Connect ${picker.bundle.label} with OAuth`}
                  </button>
                )}
                <label className={styles.tokenField}>
                  <span>{connector?.oauthAvailable ? `Or use ${secretLabel.toLowerCase()}` : secretLabel}</span>
                  <input type="password" autoComplete="off" placeholder={connector?.connected ? 'Leave blank to keep current credential' : 'Enter credential'} value={picker.secret} onChange={(event) => setPicker({ ...picker, secret: event.target.value })} style={input} />
                  <small>{connector?.connected ? 'Entering a new value replaces the shared credential.' : 'Encrypted before storage and never returned by the API.'}</small>
                </label>
              </div>
            )}

            <div className={styles.safetyNote}><ShieldCheck size={16} /><span><strong>Safe by default</strong><small>Read actions are ready immediately. Write actions stay disabled until you review and enable each one.</small></span></div>
            {error && <p style={{ ...errorText, marginTop: 12 }}>{error}</p>}
            <div className={styles.setupActions}>
              <button type="button" onClick={() => void installBundle(picker)} disabled={saving || incomplete} className="btn btn-primary">{saving ? <Loader2 size={14} className={styles.spinner} /> : <PackagePlus size={14} />} {installed === picker.bundle.templateIds.length ? 'Update connection' : installed ? 'Install missing actions' : `Install ${picker.bundle.templateIds.length} actions`}</button>
              <button type="button" onClick={() => setPicker('gallery')} disabled={saving} className="btn btn-ghost">Back</button>
            </div>
          </div>
        )
      })()}

      {form && (
        <div style={card}>
          <p style={label}>{form.id ? 'Edit tool' : 'New tool'}</p>

          <div style={{ marginBottom: 12 }}>
            <input placeholder="tool_name (letters, numbers, _ -)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <textarea placeholder="Description — tell the agent when to use this tool" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input, minHeight: 60, resize: 'vertical' }} />
          </div>
          <div style={{ ...row }}>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as ToolMethod })} style={{ ...input, width: 120 }}>
              {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as ToolMethod[]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input placeholder="https://api.example.com/orders/{orderId}" value={form.urlTemplate} onChange={(e) => setForm({ ...form, urlTemplate: e.target.value })} style={input} />
          </div>

          <p style={{ ...label, marginTop: 16 }}>Parameters</p>
          {form.params.map((p, i) => (
            <div key={i} style={row}>
              <input placeholder="name" value={p.name} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, name: e.target.value }; setForm({ ...form, params }) }} style={{ ...input, width: 140 }} />
              <select value={p.type} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, type: e.target.value as ToolParamType }; setForm({ ...form, params }) }} style={{ ...input, width: 110 }}>
                {(['string', 'number', 'boolean'] as ToolParamType[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="description" value={p.description} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, description: e.target.value }; setForm({ ...form, params }) }} style={input} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={p.required} onChange={(e) => { const params = [...form.params]; params[i] = { ...p, required: e.target.checked }; setForm({ ...form, params }) }} /> req
              </label>
              <button type="button" onClick={() => setForm({ ...form, params: form.params.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, params: [...form.params, { name: '', type: 'string', description: '', required: true }] })} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>+ Parameter</button>

          <p style={{ ...label, marginTop: 16 }}>Headers</p>
          {form.headers.map((h, i) => (
            <div key={i} style={row}>
              <input placeholder="Header" value={h.key} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, key: e.target.value }; setForm({ ...form, headers }) }} style={{ ...input, width: 200 }} />
              <input placeholder="value" value={h.value} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, value: e.target.value }; setForm({ ...form, headers }) }} style={input} />
              <button type="button" onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>+ Header</button>

          {(form.method === 'POST' || form.method === 'PUT' || form.method === 'PATCH') && (
            <>
              <p style={{ ...label, marginTop: 16 }}>Request body</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 8px' }}>
                Optional JSON template. Use parameter placeholders such as <code style={{ fontFamily: 'var(--font-mono)' }}>{'{email}'}</code>. Leave blank to send unused parameters automatically.
              </p>
              <div style={{ ...row, alignItems: 'flex-start' }}>
                <select value={form.bodyEncoding} onChange={(e) => setForm({ ...form, bodyEncoding: e.target.value as ToolBodyEncoding })} style={{ ...input, width: 160 }}>
                  <option value="json">JSON</option>
                  <option value="form">Form encoded</option>
                </select>
                <textarea
                  aria-label="Request body template"
                  placeholder={'{\n  "customer": { "email": "{email}" }\n}'}
                  value={form.bodyTemplate}
                  onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
                  style={{ ...input, minHeight: 120, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>
            </>
          )}

          <p style={{ ...label, marginTop: 16 }}>Authentication</p>
          <div style={row}>
            <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as ToolAuthType })} style={{ ...input, width: 160 }}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
            </select>
            {form.authType === 'header' && <input placeholder="X-API-Key" value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} style={{ ...input, width: 180 }} />}
            {form.authType !== 'none' && <input type="password" placeholder={form.hasSecret ? '•••• set (leave blank to keep)' : 'secret'} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} style={input} />}
          </div>

          <p style={{ ...label, marginTop: 16 }}>Access</p>
          <div style={row}>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ToolKind })} style={{ ...input, width: 160 }}>
              <option value="read">Read (lookup)</option>
              <option value="write">Write (changes data)</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-mute)' }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          {form.kind === 'write' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', marginTop: 8, padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)' }}>
              <input type="checkbox" checked={form.writeEnabled} onChange={(e) => setForm({ ...form, writeEnabled: e.target.checked })} />
              Let the agent perform this action. The agent can trigger this write on its own during a conversation.
            </label>
          )}

          {form.id && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <p style={label}>Test</p>
              <textarea value={testArgs} onChange={(e) => setTestArgs(e.target.value)} style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 48 }} />
              <button type="button" onClick={() => void runTest()} disabled={testing} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, marginTop: 8 }}><Play size={13} /> {testing ? 'Running…' : 'Run test'}</button>
              {testResult && <pre style={{ marginTop: 10, padding: 12, background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--ink-dim)', overflow: 'auto', maxHeight: 240 }}>{testResult}</pre>}
            </div>
          )}

          {error && <p style={{ ...errorText, marginTop: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save tool'}</button>
            <button type="button" onClick={() => setForm(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
