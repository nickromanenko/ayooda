import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { encryptSecret } from '../lib/crypto'
import { validateMcpServerInput, type ValidatedMcpServer } from '../lib/mcp/validate'
import { listServerTools, type StoredMcpServer } from '../lib/mcp/tools'
import type { McpServerDef } from '@ayooda/shared'

const mcp = new Hono<{ Variables: AuthVariables }>()
mcp.use('*', requireAuth)
mcp.use('*', requireAgent)

const col = (c: { get: (k: 'workspaceId' | 'agentId') => string | undefined }) =>
  adminDb.collection(`workspaces/${c.get('workspaceId')!}/agents/${c.get('agentId')!}/mcpServers`)

function toDef(id: string, d: DocumentData): McpServerDef {
  return {
    id,
    name: d.name,
    url: d.url,
    transport: d.transport ?? 'streamable-http',
    headers: d.headers ?? [],
    auth: { type: d.auth?.type ?? 'none', ...(d.auth?.headerName ? { headerName: d.auth.headerName } : {}) },
    hasSecret: !!d.auth?.secretEnc,
    enabled: d.enabled !== false,
  }
}

function toStored(id: string, d: DocumentData): StoredMcpServer {
  return {
    id,
    name: d.name,
    url: d.url,
    transport: d.transport ?? 'streamable-http',
    headers: d.headers ?? [],
    auth: d.auth ?? { type: 'none' },
    enabled: d.enabled !== false,
  }
}

function buildAuth(v: ValidatedMcpServer): { type: string; headerName?: string; secretEnc?: string } {
  if (v.auth.type === 'none') return { type: 'none' }
  const out: { type: string; headerName?: string; secretEnc?: string } = { type: v.auth.type }
  if (v.auth.type === 'header' && v.auth.headerName) out.headerName = v.auth.headerName
  if (v.secret) out.secretEnc = encryptSecret(v.secret)
  return out
}

/** GET /mcp — list this agent's MCP servers (never returns secrets). */
mcp.get('/', async (c) => {
  const snap = await col(c).get()
  return c.json({ servers: snap.docs.map((d) => toDef(d.id, d.data())) })
})

/** POST /mcp — create an MCP server. */
mcp.post('/', async (c) => {
  const result = validateMcpServerInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await col(c).where('url', '==', v.url).limit(1).get()
  if (!dup.empty) return c.json({ error: 'A server with that URL already exists.' }, 409)

  const doc = {
    name: v.name, url: v.url, transport: v.transport, headers: v.headers,
    auth: buildAuth(v), enabled: v.enabled,
    createdAt: new Date(), updatedAt: new Date(),
  }
  const ref = await col(c).add(doc)
  return c.json(toDef(ref.id, doc))
})

/** PUT /mcp/:id — update a server (keeps the existing secret if none supplied). */
mcp.put('/:id', async (c) => {
  const id = c.req.param('id')
  const ref = col(c).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Server not found' }, 404)

  const result = validateMcpServerInput(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const v = result.value

  const dup = await col(c).where('url', '==', v.url).limit(1).get()
  if (!dup.empty && dup.docs[0]!.id !== id) return c.json({ error: 'A server with that URL already exists.' }, 409)

  const existing = snap.data()!
  let auth = buildAuth(v)
  // Keep the existing secret when the type still needs one and no new secret was supplied.
  if (v.auth.type !== 'none' && !v.secret && existing.auth?.secretEnc) {
    auth = { ...auth, secretEnc: existing.auth.secretEnc }
  }

  const doc = {
    name: v.name, url: v.url, transport: v.transport, headers: v.headers,
    auth, enabled: v.enabled, updatedAt: new Date(),
  }
  await ref.update(doc)
  return c.json(toDef(id, { ...existing, ...doc }))
})

/** DELETE /mcp/:id — idempotent. */
mcp.delete('/:id', async (c) => {
  await col(c).doc(c.req.param('id')).delete()
  return c.json({ ok: true })
})

/** POST /mcp/:id/test — connect and list the server's tools (a live preview). */
mcp.post('/:id/test', async (c) => {
  const id = c.req.param('id')
  const snap = await col(c).doc(id).get()
  if (!snap.exists) return c.json({ error: 'Server not found' }, 404)

  try {
    const tools = await listServerTools(toStored(id, snap.data()!))
    return c.json({
      ok: true,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? '' })),
    })
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' }, 502)
  }
})

export default mcp
