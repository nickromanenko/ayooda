import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { encryptSecret } from '../lib/crypto'
import { namespaceFor } from '../lib/pinecone'
import { agentNamespace, agentDeleteGuard } from '../lib/agents/agent-helpers'
import { LLM_MODELS, type AgentDoc } from '@ayooda/shared'

const agents = new Hono<{ Variables: AuthVariables }>()
agents.use('*', requireAuth)
agents.use('*', requireOwner)

const DEFAULT_PROMPT = 'You are a helpful customer support agent. Answer questions based on the provided context.'
const DEFAULT_MODEL = 'google/gemini-2.5-flash'

function toAgentDoc(id: string, d: DocumentData): AgentDoc {
  return {
    id,
    name: d.name,
    photoURL: d.photoURL ?? null,
    description: d.description ?? '',
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
    hasOpenRouterKey: Boolean(d.openRouterKey),
    isDefault: d.isDefault === true,
  }
}

/** GET /agents — list (default first, then newest). */
agents.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/agents`).get()
  const list = snap.docs.map((d) => toAgentDoc(d.id, d.data()))
  list.sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))
  return c.json({ agents: list })
})

/** POST /agents — create a non-default agent with a fresh namespace. */
agents.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const body = await c.req.json<{ name?: string; description?: string; systemPrompt?: string; llmModel?: string }>().catch(() => ({} as { name?: string; description?: string; systemPrompt?: string; llmModel?: string }))
  const name = body.name?.trim()
  if (!name || name.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400)
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)

  const ref = adminDb.collection(`workspaces/${ws}/agents`).doc()
  const now = new Date()
  const doc = {
    name,
    photoURL: null,
    description: body.description?.trim() ?? '',
    systemPrompt: body.systemPrompt?.trim() || DEFAULT_PROMPT,
    llmModel: body.llmModel ?? DEFAULT_MODEL,
    knowledgeNamespace: agentNamespace(ws, ref.id),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }
  await ref.set(doc)
  return c.json(toAgentDoc(ref.id, doc))
})

/** GET /agents/:id */
agents.get('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  return c.json(toAgentDoc(snap.id, snap.data()!))
})

/** PUT /agents/:id — update identity/prompt/model. */
agents.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const body = await c.req.json<{ name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string }>().catch(() => ({} as { name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string }))
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)

  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) { const n = body.name.trim(); if (!n || n.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400); update.name = n }
  if (body.photoURL !== undefined) update.photoURL = body.photoURL
  if (body.description !== undefined) update.description = body.description
  if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt
  if (body.llmModel !== undefined) update.llmModel = body.llmModel

  await ref.update(update)
  const after = await ref.get()
  return c.json(toAgentDoc(after.id, after.data()!))
})

/** PUT /agents/:id/key — store the agent's OpenRouter key (encrypted). */
agents.put('/:id/key', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)
  const body = await c.req.json<{ apiKey?: string }>().catch(() => ({} as { apiKey?: string }))
  const apiKey = body.apiKey?.trim()
  if (!apiKey || apiKey.length > 500) return c.json({ error: 'apiKey is required (max 500 chars)' }, 400)
  await ref.update({ openRouterKey: encryptSecret(apiKey), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** DELETE /agents/:id/key */
agents.delete('/:id/key', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)
  const { FieldValue } = await import('firebase-admin/firestore')
  await ref.update({ openRouterKey: FieldValue.delete(), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** POST /agents/:id/default — make this the workspace default. */
agents.post('/:id/default', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const col = adminDb.collection(`workspaces/${ws}/agents`)
  const target = await col.doc(id).get()
  if (!target.exists) return c.json({ error: 'Agent not found' }, 404)
  const all = await col.where('isDefault', '==', true).get()
  const batch = adminDb.batch()
  all.docs.forEach((d) => { if (d.id !== id) batch.update(d.ref, { isDefault: false }) })
  batch.update(col.doc(id), { isDefault: true, updatedAt: new Date() })
  await batch.commit()
  return c.json({ ok: true })
})

/** DELETE /agents/:id — guarded; purges namespace, knowledge (+ files), tools. */
agents.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const data = snap.data()!

  const [countSnap, channelsSnap] = await Promise.all([
    adminDb.collection(`workspaces/${ws}/agents`).count().get(),
    adminDb.collection(`workspaces/${ws}/channels`).where('agentId', '==', id).get(),
  ])
  const attachedChannels = channelsSnap.docs.map((d) => {
    const ch = d.data()
    return ch.type === 'telegram' ? 'Telegram' : ch.type === 'web_widget' ? 'Website' : (ch.type ?? d.id)
  })
  const guard = agentDeleteGuard({
    isDefault: data.isDefault === true,
    isLast: countSnap.data().count <= 1,
    attachedChannels,
  })
  if (!guard.ok) return c.json({ error: guard.error }, guard.status)

  // Purge vectors (best-effort)
  try { await namespaceFor(data.knowledgeNamespace ?? `ws_${ws}_ag_${id}`).deleteAll() } catch (err) { console.warn('[agents] namespace purge failed:', err) }

  // Delete knowledge docs + their storage files
  const knowledgeSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/knowledge`).get()
  for (const d of knowledgeSnap.docs) {
    const sp = d.data().storagePath as string | undefined
    if (sp) { try { await adminBucket().file(sp).delete() } catch (err) { console.warn('[agents] storage delete failed:', err) } }
    await d.ref.delete()
  }

  // Delete tools
  const toolsSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/tools`).get()
  for (const d of toolsSnap.docs) await d.ref.delete()

  await ref.delete()
  return c.json({ ok: true })
})

export default agents
