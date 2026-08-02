import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { validateRule } from '../lib/workflow/validate'
import type { WorkflowRule } from '@ayooda/shared'

const workflows = new Hono<{ Variables: AuthVariables }>()
workflows.use('*', requireAuth)
workflows.use('*', requireOwner)

function toRule(id: string, d: DocumentData): WorkflowRule {
  return { id, name: d.name, enabled: d.enabled !== false, order: d.order ?? 0, trigger: d.trigger, action: d.action }
}

/** GET /workflows — list rules ordered by `order`. */
workflows.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/workflowRules`).orderBy('order', 'asc').get()
  return c.json({ rules: snap.docs.map((d) => toRule(d.id, d.data())) })
})

/** POST /workflows — create a rule at the end of the list. */
workflows.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const col = adminDb.collection(`workspaces/${ws}/workflowRules`)
  const existing = await col.orderBy('order', 'desc').limit(1).get()
  const nextOrder = existing.empty ? 0 : (existing.docs[0]!.data().order ?? 0) + 1
  const now = new Date()
  const doc = { ...result.value, order: nextOrder, createdAt: now, updatedAt: now }
  const ref = await col.add(doc)
  return c.json(toRule(ref.id, doc))
})

/** PUT /workflows/reorder { orderedIds } — set each rule's order to its index.
 *  Declared BEFORE the `/:id` routes so the literal segment always wins. */
workflows.put('/reorder', async (c) => {
  const ws = c.get('workspaceId')
  const body = await c.req.json<{ orderedIds?: string[] }>().catch(() => ({} as { orderedIds?: string[] }))
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds : []
  const col = adminDb.collection(`workspaces/${ws}/workflowRules`)
  const existing = new Set((await col.get()).docs.map((d) => d.id))
  const batch = adminDb.batch()
  ids.forEach((id, i) => { if (existing.has(id)) batch.update(col.doc(id), { order: i, updatedAt: new Date() }) })
  await batch.commit()
  return c.json({ ok: true })
})

/** PUT /workflows/:id — update a rule. */
workflows.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/workflowRules/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Rule not found' }, 404)
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  await ref.update({ ...result.value, updatedAt: new Date() })
  return c.json(toRule(ref.id, { ...snap.data(), ...result.value }))
})

/** DELETE /workflows/:id — idempotent. */
workflows.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  await adminDb.doc(`workspaces/${ws}/workflowRules/${c.req.param('id')}`).delete()
  return c.json({ ok: true })
})

export default workflows
