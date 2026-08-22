import { Hono } from 'hono'
import { FieldValue, type DocumentData } from 'firebase-admin/firestore'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { namespaceFor } from '../lib/pinecone'
import { agentNamespace, agentDeleteGuard } from '../lib/agents/agent-helpers'
import { LLM_MODELS, agentRole, isAgentRoleId, DEFAULT_AGENT_ROLE_ID, validateAgentImage, MAX_AGENT_IMAGE_BYTES, type AgentDoc } from '@ayooda/shared'

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
    role: d.role ?? null,
    description: d.description ?? '',
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
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
  const body = await c.req.json<{ name?: string; description?: string; systemPrompt?: string; llmModel?: string; role?: string }>().catch(() => ({} as { name?: string; description?: string; systemPrompt?: string; llmModel?: string; role?: string }))
  const name = body.name?.trim()
  if (!name || name.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400)
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)
  if (body.role !== undefined && !isAgentRoleId(body.role)) return c.json({ error: 'Invalid role' }, 400)

  // The role's only job: seed the starting prompt so a freshly created agent is
  // already useful. An explicit systemPrompt in the body always wins.
  const role = body.role ?? DEFAULT_AGENT_ROLE_ID
  const seededPrompt = agentRole(role)?.systemPrompt ?? DEFAULT_PROMPT

  const ref = adminDb.collection(`workspaces/${ws}/agents`).doc()
  const now = new Date()
  const doc = {
    name,
    photoURL: null,
    role,
    description: body.description?.trim() ?? '',
    systemPrompt: body.systemPrompt?.trim() || seededPrompt,
    llmModel: body.llmModel ?? DEFAULT_MODEL,
    knowledgeNamespace: agentNamespace(ws, ref.id),
    isDefault: false,
    // Seeded so the Usage tab can distinguish "nothing yet" from "not tracked":
    // trackedSince marks when these counters started, since they only accrue
    // forward. Conversation counts are derived from the conversations
    // collection instead, so those stay accurate for the agent's whole life.
    usage: { messageCount: 0, tokenCount: 0, trackedSince: now },
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
  const body = await c.req.json<{ name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string; role?: string }>().catch(() => ({} as { name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string; role?: string }))
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)
  if (body.role !== undefined && !isAgentRoleId(body.role)) return c.json({ error: 'Invalid role' }, 400)

  const update: Record<string, unknown> = { updatedAt: new Date() }
  // Changing the role later relabels the agent; it deliberately does not rewrite
  // a systemPrompt the owner may have customised.
  if (body.role !== undefined) update.role = body.role
  if (body.name !== undefined) { const n = body.name.trim(); if (!n || n.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400); update.name = n }
  if (body.photoURL !== undefined) update.photoURL = body.photoURL
  if (body.description !== undefined) update.description = body.description
  if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt
  if (body.llmModel !== undefined) update.llmModel = body.llmModel

  await ref.update(update)
  const after = await ref.get()
  return c.json(toAgentDoc(after.id, after.data()!))
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

  // Delete the agent's own subcollections. Channels are not among them: the
  // guard above refuses to delete an agent that still has one attached.
  for (const sub of ['tools', 'skills', 'workflowRules']) {
    const subSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/${sub}`).get()
    for (const d of subSnap.docs) await d.ref.delete()
  }

  await ref.delete()
  return c.json({ ok: true })
})

/**
 * POST /agents/:id/photo — upload the agent's logo (multipart, field "file").
 *
 * The object is made publicly readable because the chat widget renders it with a
 * plain <img src> on the customer's own site, where no credentials exist. Only
 * this one object is exposed, not the bucket.
 */
agents.post('/:id/photo', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart form-data)' }, 400)

  const validation = validateAgentImage(file.name, file.size)
  if (!validation.ok) {
    return c.json({ error: validation.error }, file.size > MAX_AGENT_IMAGE_BYTES ? 413 : 400)
  }

  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  // Cache-bust on replacement: a fixed key would keep serving the old image from
  // CDN/browser caches long after the owner changed it.
  const storagePath = `workspaces/${ws}/agents/${id}/logo-${Date.now()}${ext}`
  const object = adminBucket().file(storagePath)

  await object.save(Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || 'image/png',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  })

  try {
    await object.makePublic()
  } catch (err) {
    await object.delete().catch(() => {})
    console.error('[agents] makePublic failed for agent logo:', err)
    return c.json({ error: 'Could not publish the image. Check bucket public-access settings.' }, 500)
  }

  const photoURL = `https://storage.googleapis.com/${adminBucket().name}/${storagePath}`
  const previousPath = snap.data()!.photoStoragePath as string | undefined
  await ref.update({ photoURL, photoStoragePath: storagePath, updatedAt: new Date() })

  // Best-effort cleanup of the object we just replaced.
  if (previousPath && previousPath !== storagePath) {
    await adminBucket().file(previousPath).delete().catch(() => {})
  }

  return c.json({ photoURL })
})

/** DELETE /agents/:id/photo — clear the logo and remove the stored object. */
agents.delete('/:id/photo', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)

  const path = snap.data()!.photoStoragePath as string | undefined
  if (path) await adminBucket().file(path).delete().catch(() => {})
  await ref.update({ photoURL: null, photoStoragePath: FieldValue.delete(), updatedAt: new Date() })
  return c.json({ ok: true })
})

export default agents
