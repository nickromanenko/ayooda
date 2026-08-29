'use client'

import { use, useState, useEffect, useCallback } from 'react'
import { Loader2, Trash2, Plus, Plug } from 'lucide-react'
import { apiRequest, apiRequestOrThrow } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import { MCP_TRANSPORT_LABELS, type McpServerDef, type McpTransportType, type McpServerAuthType } from '@ayooda/shared'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, input, errorText } from '@/components/dashboard/ui'

const row: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 }

interface HeaderRow { key: string; value: string }
interface FormState {
  id: string | null
  name: string
  url: string
  transport: McpTransportType
  headers: HeaderRow[]
  authType: McpServerAuthType
  headerName: string
  secret: string
  hasSecret: boolean
  enabled: boolean
}

const emptyForm: FormState = {
  id: null, name: '', url: '', transport: 'streamable-http',
  headers: [], authType: 'none', headerName: '', secret: '', hasSecret: false, enabled: true,
}

export default function AgentMcpPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)

  const [servers, setServers] = useState<McpServerDef[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [testId, setTestId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: { name: string; description: string }[]; error?: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(`/agents/${agentId}/mcp`)
      if (!res.ok) throw new Error('Could not load MCP servers.')
      const d = await res.json() as { servers: McpServerDef[] }; setServers(d.servers)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load MCP servers.')
    } finally { setLoading(false) }
  }, [agentId])
  useEffect(() => { void load() }, [load])

  function startCreate() { setForm({ ...emptyForm }); setError(''); setTestResult(null) }
  function startEdit(s: McpServerDef) {
    setForm({
      id: s.id, name: s.name, url: s.url, transport: s.transport,
      headers: s.headers.map((h) => ({ ...h })),
      authType: s.auth.type, headerName: s.auth.headerName ?? '', secret: '', hasSecret: s.hasSecret,
      enabled: s.enabled,
    })
    setError(''); setTestResult(null)
  }

  function payload(f: FormState) {
    return {
      name: f.name.trim(), url: f.url.trim(), transport: f.transport,
      headers: f.headers.filter((h) => h.key.trim()),
      auth: { type: f.authType, ...(f.authType === 'header' ? { headerName: f.headerName.trim() } : {}), ...(f.secret ? { secret: f.secret } : {}) },
      enabled: f.enabled,
    }
  }

  async function save() {
    if (!form) return
    const isCreating = !form.id
    setSaving(true); setError('')
    try {
      const res = form.id
        ? await apiRequest(`/agents/${agentId}/mcp/${form.id}`, { method: 'PUT', body: JSON.stringify(payload(form)) })
        : await apiRequest(`/agents/${agentId}/mcp`, { method: 'POST', body: JSON.stringify(payload(form)) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the server'); return }
      if (isCreating) {
        trackProductEvent('MCP Server Connected', { transport: form.transport, auth_type: form.authType })
      }
      setForm(null); await load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this MCP server connection?')) return
    setBusyId(id)
    try { await apiRequestOrThrow(`/agents/${agentId}/mcp/${id}`, { method: 'DELETE' }, 'Could not delete this MCP server.'); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete this MCP server.') }
    finally { setBusyId('') }
  }

  async function test(id: string) {
    setTestId(id); setTestResult(null)
    try {
      const res = await apiRequest(`/agents/${agentId}/mcp/${id}/test`, { method: 'POST' })
      setTestResult(await res.json().catch(() => ({ ok: false, error: 'Invalid response' })))
    } catch {
      setTestResult({ ok: false, error: 'Connection failed' })
    } finally { setTestId(null) }
  }

  if (loading) return <Loading />

  return (
    <>
      <div className="dashboard-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
          Connect this agent to a Model Context Protocol server — it will discover that server&apos;s tools and call them during conversations.
        </p>
        {!form && (
          <button type="button" onClick={startCreate} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Plus size={14} /> New server
          </button>
        )}
      </div>

      {!form && (
        <div style={card}>
          <p style={label}>This agent&apos;s MCP servers</p>
          {servers.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
              No servers yet. Add one to give this agent tools from an external MCP server.
            </p>
          )}
          {servers.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>
                  {s.name}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-mute)', marginLeft: 8 }}>{MCP_TRANSPORT_LABELS[s.transport]}</span>
                </p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</p>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, background: s.enabled ? 'rgba(52,211,153,0.15)' : 'var(--panel-2)', color: s.enabled ? 'var(--mint)' : 'var(--ink-mute)', flexShrink: 0 }}>{s.enabled ? 'on' : 'off'}</span>
              <button type="button" onClick={() => void test(s.id)} disabled={testId === s.id} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, flexShrink: 0 }}>
                {testId === s.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={13} />} Test
              </button>
              <button type="button" onClick={() => startEdit(s)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, flexShrink: 0 }}>Edit</button>
              <button type="button" onClick={() => void remove(s.id)} disabled={busyId === s.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>
                {busyId === s.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {testResult && (
        <div style={card}>
          <p style={label}>Connection test</p>
          {testResult.ok ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0 }}>
                {testResult.tools?.length ?? 0} tool{(testResult.tools?.length ?? 0) === 1 ? '' : 's'} discovered:
              </p>
              {(testResult.tools ?? []).map((t) => (
                <div key={t.name} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                  <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-mono)' }}>{t.name}</p>
                  {t.description && <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '4px 0 0' }}>{t.description}</p>}
                </div>
              ))}
            </>
          ) : (
            <p style={{ ...errorText, margin: 0 }}>{testResult.error ?? 'Connection failed'}</p>
          )}
        </div>
      )}

      {form && (
        <div style={card}>
          <p style={label}>{form.id ? 'Edit server' : 'New MCP server'}</p>

          <div style={{ marginBottom: 12 }}>
            <input placeholder="Server name (e.g. Shopify MCP)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
          </div>
          <div className="responsive-form-row" style={{ ...row }}>
            <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransportType })} style={{ ...input, width: 170 }}>
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">HTTP + SSE</option>
            </select>
            <input placeholder="https://mcp.example.com/mcp" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={input} />
          </div>

          <p style={{ ...label, marginTop: 16 }}>Headers</p>
          {form.headers.map((h, i) => (
            <div key={i} className="responsive-form-row" style={row}>
              <input placeholder="Header" value={h.key} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, key: e.target.value }; setForm({ ...form, headers }) }} style={{ ...input, width: 200 }} />
              <input placeholder="value" value={h.value} onChange={(e) => { const headers = [...form.headers]; headers[i] = { ...h, value: e.target.value }; setForm({ ...form, headers }) }} style={input} />
              <button type="button" onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>+ Header</button>

          <p style={{ ...label, marginTop: 16 }}>Authentication</p>
          <div className="responsive-form-row" style={row}>
            <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value as McpServerAuthType })} style={{ ...input, width: 160 }}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
            </select>
            {form.authType === 'header' && <input placeholder="X-API-Key" value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} style={{ ...input, width: 180 }} />}
            {form.authType !== 'none' && <input type="password" placeholder={form.hasSecret ? '•••• set (leave blank to keep)' : 'secret'} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} style={input} />}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-mute)', marginTop: 16 }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
          </label>

          {error && <p style={{ ...errorText, marginTop: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save server'}</button>
            <button type="button" onClick={() => setForm(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
