import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { encryptSecret } from '../lib/crypto'
import { validateToolInput, type ValidatedTool } from '../lib/tools/validate'
import { executeTool, type StoredTool } from '../lib/chat/tools'
import type { ToolDef } from '@ayooda/shared'

const tools = new Hono<{ Variables: AuthVariables }>()
tools.use('*', requireAuth)
tools.use('*', requireAgent)

function toToolDef(id: string, d: DocumentData): ToolDef {
  return {
    id,
    name: d.name,
    description: d.description,
    method: d.method,
    urlTemplate: d.urlTemplate,
    params: d.params ?? [],
    headers: d.headers ?? [],
    ...(d.bodyTemplate ? { bodyTemplate: d.bodyTemplate, bodyEncoding: d.bodyEncoding ?? 'json' } : {}),
    auth: { type: d.auth?.type ?? 'none', ...(d.auth?.headerName ? { headerName: d.auth.headerName } : {}) },
    hasSecret: !!d.auth?.secretEnc,
    kind: d.kind,
    writeEnabled: !!d.writeEnabled,
    enabled: d.enabled !== false,
  }
}

function buildAuth(v: ValidatedTool): { type: string; headerName?: string; secretEnc?: string } {
  if (v.auth.type === 'none') return { type: 'none' }
  const out: { type: string; headerName?: string; secretEnc?: string } = { type: v.auth.type }
  if (v.auth.type === 'header' && v.auth.headerName) out.headerName = v.auth.headerName
  if (v.secret) out.secretEnc = encryptSecret(v.secret)
  return out
}

function toStoredTool(id: string, d: DocumentData): StoredTool {
  return {
    id, name: d.name, description: d.description, method: d.method, urlTemplate: d.urlTemplate,
    params: d.params ?? [], headers: d.headers ?? [], auth: d.auth ?? { type: 'none' },
    ...(d.bodyTemplate ? { bodyTemplate: d.bodyTemplate, bodyEncoding: d.bodyEncoding ?? 'json' } : {}),
    kind: d.kind, writeEnabled: !!d.writeEnabled, enabled: d.enabled !== false,
  }
}

/** GET /tools — list this workspace's tools (never returns secrets). */
tools.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const snap = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).get()
  return c.json({ tools: snap.docs.map((d) => toToolDef(d.id, d.data())) })
})

/** POST /tools — create a tool. */
tools.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const doc = {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers,
    ...(v.bodyTemplate ? { bodyTemplate: v.bodyTemplate, bodyEncoding: v.bodyEncoding ?? 'json' } : {}),
    auth: buildAuth(v),
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled,
    createdAt: new Date(), updatedAt: new Date(),
  }
  const ref = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).add(doc)
  return c.json(toToolDef(ref.id, doc))
})

/** PUT /tools/:id — update a tool (keeps the existing secret if none supplied). */
tools.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)

  const result = validateToolInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await adminDb.collection(`workspaces/${ws}/agents/${agentId}/tools`).where('name', '==', v.name).limit(1).get()
  if (!dup.empty && dup.docs[0]!.id !== id) return c.json({ error: 'A tool with that name already exists.' }, 409)

  const existing = snap.data()!
  let auth = buildAuth(v)
  // Keep the existing secret when the type still needs one and no new secret was supplied.
  if (v.auth.type !== 'none' && !v.secret && existing.auth?.secretEnc) {
    auth = { ...auth, secretEnc: existing.auth.secretEnc }
  }

  const doc = {
    name: v.name, description: v.description, method: v.method, urlTemplate: v.urlTemplate,
    params: v.params, headers: v.headers,
    bodyTemplate: v.bodyTemplate ?? null,
    bodyEncoding: v.bodyTemplate ? (v.bodyEncoding ?? 'json') : null,
    auth,
    kind: v.kind, writeEnabled: v.writeEnabled, enabled: v.enabled, updatedAt: new Date(),
  }
  await ref.update(doc)
  return c.json(toToolDef(id, { ...existing, ...doc }))
})

/** DELETE /tools/:id — idempotent. */
tools.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  await adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${c.req.param('id')}`).delete()
  return c.json({ ok: true })
})

/** POST /tools/:id/test { args } — run the tool through the guarded executor. */
tools.post('/:id/test', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const id = c.req.param('id')
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${agentId}/tools/${id}`).get()
  if (!snap.exists) return c.json({ error: 'Tool not found' }, 404)
  const body = await c.req.json<{ args?: Record<string, unknown> }>().catch(() => ({} as { args?: Record<string, unknown> }))
  const r = await executeTool(toStoredTool(id, snap.data()!), body.args ?? {})
  return c.json(r)
})

export default tools
