import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { validateRule } from '../lib/workflow/validate'
import { graphFromRules, validateWorkflowGraph } from '../lib/workflow/graph'
import type { WorkflowAction, WorkflowGraph, WorkflowGraphResponse, WorkflowRule, WorkflowTargets } from '@ayooda/shared'

/**
 * Escalation rules describe how one agent behaves — a support agent and a sales
 * agent want different hand-off triggers — so they live under the agent, at
 * workspaces/{ws}/agents/{agentId}/workflowRules.
 */
const workflows = new Hono<{ Variables: AuthVariables }>()
workflows.use('*', requireAuth)
workflows.use('*', requireAgent)

export const rulesPath = (workspaceId: string, agentId: string) =>
  `workspaces/${workspaceId}/agents/${agentId}/workflowRules`
export const graphPath = (workspaceId: string, agentId: string) =>
  `workspaces/${workspaceId}/agents/${agentId}/workflowGraph/main`

function rulesCol(c: { get: (k: 'workspaceId' | 'agentId') => string | undefined }) {
  return adminDb.collection(rulesPath(c.get('workspaceId')!, c.get('agentId')!))
}

function toRule(id: string, d: DocumentData): WorkflowRule {
  return { id, name: d.name, enabled: d.enabled !== false, order: d.order ?? 0, trigger: d.trigger, action: d.action }
}

async function invalidTarget(workspaceId: string, currentAgentId: string, action: WorkflowAction): Promise<string | null> {
  if (action.type === 'assign_teammate') {
    const teammate = await adminDb.doc(`users/${action.teammateUid}`).get()
    return teammate.exists && teammate.data()?.workspaceId === workspaceId
      ? null
      : 'Selected teammate is not in this workspace.'
  }
  if (action.type === 'route_agent') {
    if (action.agentId === currentAgentId) return 'Choose a different agent to route to.'
    return (await adminDb.doc(`workspaces/${workspaceId}/agents/${action.agentId}`).get()).exists
      ? null
      : 'Selected agent is not in this workspace.'
  }
  return null
}

async function invalidGraphTarget(workspaceId: string, currentAgentId: string, graph: WorkflowGraph): Promise<string | null> {
  for (const node of graph.nodes) {
    if (node.kind !== 'action') continue
    const error = await invalidTarget(workspaceId, currentAgentId, node.action)
    if (error) return `${node.name}: ${error}`
  }
  return null
}

async function legacyRules(c: { get: (k: 'workspaceId' | 'agentId') => string | undefined }): Promise<WorkflowRule[]> {
  const snap = await rulesCol(c).orderBy('order', 'asc').get()
  return snap.docs.map((doc) => toRule(doc.id, doc.data()))
}

/** GET /agents/:agentId/workflows — list rules ordered by `order`. */
workflows.get('/', async (c) => {
  const snap = await rulesCol(c).orderBy('order', 'asc').get()
  return c.json({ rules: snap.docs.map((d) => toRule(d.id, d.data())) })
})

/** GET /targets — safe workspace-local destinations for richer actions. */
workflows.get('/targets', async (c) => {
  const workspaceId = c.get('workspaceId')!
  const currentAgentId = c.get('agentId')!
  const [membersSnap, agentsSnap] = await Promise.all([
    adminDb.collection('users').where('workspaceId', '==', workspaceId).get(),
    adminDb.collection(`workspaces/${workspaceId}/agents`).get(),
  ])
  const targets: WorkflowTargets = {
    teammates: membersSnap.docs.map((doc) => ({
      uid: doc.id,
      name: String(doc.data().displayName ?? '').trim(),
      email: String(doc.data().email ?? '').trim(),
    })).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    agents: agentsSnap.docs
      .filter((doc) => doc.id !== currentAgentId)
      .map((doc) => ({ id: doc.id, name: String(doc.data().name ?? 'Untitled agent') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
  return c.json(targets)
})

/** GET /graph — persisted graph, or a non-active preview converted from legacy rules. */
workflows.get('/graph', async (c) => {
  const workspaceId = c.get('workspaceId')!
  const agentId = c.get('agentId')!
  const [snap, rules] = await Promise.all([
    adminDb.doc(graphPath(workspaceId, agentId)).get(),
    legacyRules(c),
  ])
  if (!snap.exists) {
    const response: WorkflowGraphResponse = { graph: graphFromRules(rules), persisted: false, legacyRuleCount: rules.length }
    return c.json(response)
  }
  const parsed = validateWorkflowGraph(snap.data())
  if (!parsed.ok) return c.json({ error: `Stored workflow graph is invalid: ${parsed.error}` }, 500)
  const response: WorkflowGraphResponse = { graph: parsed.value, persisted: true, legacyRuleCount: rules.length }
  return c.json(response)
})

/** PUT /graph — validate targets and replace the active graph atomically. */
workflows.put('/graph', async (c) => {
  const workspaceId = c.get('workspaceId')!
  const agentId = c.get('agentId')!
  const parsed = validateWorkflowGraph(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const targetError = await invalidGraphTarget(workspaceId, agentId, parsed.value)
  if (targetError) return c.json({ error: targetError }, 400)
  await adminDb.doc(graphPath(workspaceId, agentId)).set({ ...parsed.value, updatedAt: new Date() })
  const response: WorkflowGraphResponse = { graph: parsed.value, persisted: true, legacyRuleCount: (await legacyRules(c)).length }
  return c.json(response)
})

/** POST /graph/migrate — activate the current ordered rules as an equivalent graph. */
workflows.post('/graph/migrate', async (c) => {
  const workspaceId = c.get('workspaceId')!
  const agentId = c.get('agentId')!
  const rules = await legacyRules(c)
  const graph = graphFromRules(rules)
  const targetError = await invalidGraphTarget(workspaceId, agentId, graph)
  if (targetError) return c.json({ error: targetError }, 400)
  await adminDb.doc(graphPath(workspaceId, agentId)).set({ ...graph, updatedAt: new Date(), migratedAt: new Date() })
  const response: WorkflowGraphResponse = { graph, persisted: true, legacyRuleCount: rules.length }
  return c.json(response)
})

/** DELETE /graph — deactivate graph mode and resume executing legacy rules. */
workflows.delete('/graph', async (c) => {
  await adminDb.doc(graphPath(c.get('workspaceId')!, c.get('agentId')!)).delete()
  return c.json({ ok: true })
})

/** POST /agents/:agentId/workflows — create a rule at the end of the list. */
workflows.post('/', async (c) => {
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const targetError = await invalidTarget(c.get('workspaceId')!, c.get('agentId')!, result.value.action)
  if (targetError) return c.json({ error: targetError }, 400)
  const col = rulesCol(c)
  const existing = await col.orderBy('order', 'desc').limit(1).get()
  const nextOrder = existing.empty ? 0 : (existing.docs[0]!.data().order ?? 0) + 1
  const now = new Date()
  const doc = { ...result.value, order: nextOrder, createdAt: now, updatedAt: now }
  const ref = await col.add(doc)
  return c.json(toRule(ref.id, doc))
})

/** PUT /agents/:agentId/workflows/reorder { orderedIds } — set each rule's order
 *  to its index. Declared BEFORE the `/:id` routes so the literal segment wins. */
workflows.put('/reorder', async (c) => {
  const body = await c.req.json<{ orderedIds?: string[] }>().catch(() => ({} as { orderedIds?: string[] }))
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds : []
  const col = rulesCol(c)
  const existing = new Set((await col.get()).docs.map((d) => d.id))
  const batch = adminDb.batch()
  ids.forEach((id, i) => { if (existing.has(id)) batch.update(col.doc(id), { order: i, updatedAt: new Date() }) })
  await batch.commit()
  return c.json({ ok: true })
})

/** PUT /agents/:agentId/workflows/:id — update a rule. */
workflows.put('/:id', async (c) => {
  const ref = rulesCol(c).doc(c.req.param('id'))
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Rule not found' }, 404)
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const targetError = await invalidTarget(c.get('workspaceId')!, c.get('agentId')!, result.value.action)
  if (targetError) return c.json({ error: targetError }, 400)
  await ref.update({ ...result.value, updatedAt: new Date() })
  return c.json(toRule(ref.id, { ...snap.data(), ...result.value }))
})

/** DELETE /agents/:agentId/workflows/:id — idempotent. */
workflows.delete('/:id', async (c) => {
  await rulesCol(c).doc(c.req.param('id')).delete()
  return c.json({ ok: true })
})

export default workflows
