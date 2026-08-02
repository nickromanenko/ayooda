'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Trash2, Plus, Play } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { TOOL_TEMPLATES, applyTemplate, type ToolDef, type ToolMethod, type ToolParamType, type ToolAuthType, type ToolKind, type ToolTemplate } from '@ayooda/shared'

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }
const row: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 }

interface ParamRow { name: string; type: ToolParamType; description: string; required: boolean }
interface HeaderRow { key: string; value: string }
interface FormState {
  id: string | null
  name: string; description: string; method: ToolMethod; urlTemplate: string
  params: ParamRow[]; headers: HeaderRow[]
  authType: ToolAuthType; headerName: string; secret: string; hasSecret: boolean
  kind: ToolKind; writeEnabled: boolean; enabled: boolean
}

const emptyForm: FormState = {
  id: null, name: '', description: '', method: 'GET', urlTemplate: '',
  params: [], headers: [], authType: 'none', headerName: '', secret: '', hasSecret: false,
  kind: 'read', writeEnabled: false, enabled: true,
}

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolDef[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [agentList, setAgentList] = useState<{ id: string; name: string; isDefault: boolean }[]>([])
  const [agentId, setAgentId] = useState<string>('')
  const [picker, setPicker] = useState<'gallery' | { template: ToolTemplate; setup: Record<string, string> } | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await apiRequest('/agents')
      if (res.ok) {
        const d = await res.json() as { agents: { id: string; name: string; isDefault: boolean }[] }
        setAgentList(d.agents)
        setAgentId((prev) => prev || d.agents.find((a) => a.isDefault)?.id || d.agents[0]?.id || '')
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!agentId) return
    try {
      const res = await apiRequest(`/agents/${agentId}/tools`)
      if (res.ok) { const d = await res.json() as { tools: ToolDef[] }; setTools(d.tools) }
    } finally { setLoading(false) }
  }, [agentId])
  useEffect(() => { if (agentId) void load() }, [load, agentId])

  function startCreate() { setForm({ ...emptyForm }); setError(''); setTestResult(''); setTestArgs('{}') }
  function chooseTemplate(template: ToolTemplate) {
    setPicker({ template, setup: Object.fromEntries(template.setupFields.map((f) => [f.key, ''])) })
  }
  function applyPickedTemplate(p: { template: ToolTemplate; setup: Record<string, string> }) {
    const a = applyTemplate(p.template, p.setup)
    setForm({
      id: null,
      name: a.name, description: a.description, method: a.method, urlTemplate: a.urlTemplate,
      params: a.params.map((x) => ({ ...x })), headers: a.headers.map((x) => ({ ...x })),
      authType: a.auth.type, headerName: a.auth.headerName ?? '', secret: '', hasSecret: false,
      kind: a.kind, writeEnabled: false, enabled: true,
    })
    setPicker(null); setError(''); setTestResult(''); setTestArgs('{}')
  }
  function startEdit(t: ToolDef) {
    setForm({
      id: t.id, name: t.name, description: t.description, method: t.method, urlTemplate: t.urlTemplate,
      params: t.params.map((p) => ({ ...p })), headers: t.headers.map((h) => ({ ...h })),
      authType: t.auth.type, headerName: t.auth.headerName ?? '', secret: '', hasSecret: t.hasSecret,
      kind: t.kind, writeEnabled: t.writeEnabled, enabled: t.enabled,
    })
    setError(''); setTestResult(''); setTestArgs('{}')
  }

  function payload(f: FormState) {
    return {
      name: f.name.trim(), description: f.description.trim(), method: f.method, urlTemplate: f.urlTemplate.trim(),
      params: f.params, headers: f.headers.filter((h) => h.key.trim()),
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

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Tools</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Let your agent call your APIs — look up orders, check inventory, update records.</p>
        </div>
        {!form && !picker && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setPicker('gallery')} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 16px' }}>Start from a template</button>
            <button type="button" onClick={startCreate} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> New tool</button>
          </div>
        )}
      </div>

      {agentList.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-mute)', marginRight: 8 }}>Agent</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14 }}>
            {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </div>
      )}

      {!form && !picker && (
        <div style={card}>
          <p style={label}>Your tools</p>
          {tools.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No tools yet. Create one to give your agent an action.</p>}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={label}>Choose a template</p>
            <button type="button" onClick={() => setPicker(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Cancel</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {TOOL_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => chooseTemplate(t)} style={{ textAlign: 'left', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: 14, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t.label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 20, background: 'var(--panel-2)', color: 'var(--ink-mute)' }}>{t.category}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{t.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {picker && picker !== 'gallery' && (
        <div style={card}>
          <p style={label}>{picker.template.label}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 16 }}>{picker.template.description}</p>
          {picker.template.setupFields.map((f) => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input
                placeholder={f.placeholder}
                value={picker.setup[f.key] ?? ''}
                onChange={(e) => setPicker({ template: picker.template, setup: { ...picker.setup, [f.key]: e.target.value } })}
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
              style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: picker.template.setupFields.some((f) => !picker.setup[f.key]?.trim()) ? 0.5 : 1 }}
            >
              Continue
            </button>
            <button type="button" onClick={() => setPicker('gallery')} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Back</button>
          </div>
        </div>
      )}

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

          {error && <p style={{ fontSize: 12, color: '#f87171', marginTop: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save tool'}</button>
            <button type="button" onClick={() => setForm(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
