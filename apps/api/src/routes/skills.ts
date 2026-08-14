import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import {
  SKILLS,
  skillDef,
  isSkillId,
  validateSkillConfig,
  meetsTier,
  type AgentSkillView,
  type PlanTier,
} from '@ayooda/shared'

const skills = new Hono<{ Variables: AuthVariables }>()
skills.use('*', requireAuth)
skills.use('*', requireOwner)
skills.use('*', requireAgent)

async function workspaceTier(ws: string): Promise<PlanTier | null> {
  const snap = await adminDb.doc(`workspaces/${ws}`).get()
  return (snap.data()?.subscription?.tier as PlanTier | null | undefined) ?? null
}

/** GET /agents/:agentId/skills — catalogue merged with attachment state. */
skills.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const [snap, tier] = await Promise.all([
    adminDb.collection(`workspaces/${ws}/agents/${agentId}/skills`).get(),
    workspaceTier(ws),
  ])
  const rows = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const view: AgentSkillView[] = SKILLS.map((def) => {
    const row = rows.get(def.id)
    const parsed = validateSkillConfig(def.id, row?.config ?? def.defaultConfig)
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      enabled: row?.enabled === true,
      config: parsed.ok ? parsed.value : def.defaultConfig,
      locked: !meetsTier(tier, def.minTier),
    }
  })
  return c.json({ skills: view })
})

/** PUT /agents/:agentId/skills/:skillId — attach or update. */
skills.put('/:skillId', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const skillId = c.req.param('skillId')
  if (!isSkillId(skillId)) return c.json({ error: 'Unknown skill.' }, 404)
  const def = skillDef(skillId)!

  const body = await c.req.json<{ enabled?: unknown; config?: unknown }>().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'enabled is required.' }, 400)

  const parsed = validateSkillConfig(skillId, body.config ?? def.defaultConfig)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  if (body.enabled && !meetsTier(await workspaceTier(ws), def.minTier)) {
    return c.json({ error: `${def.label} is not available on your plan.` }, 403)
  }

  const ref = adminDb.doc(`workspaces/${ws}/agents/${agentId}/skills/${skillId}`)
  const now = new Date()
  const exists = (await ref.get()).exists
  await ref.set(
    { enabled: body.enabled, config: parsed.value, updatedAt: now, ...(exists ? {} : { createdAt: now }) },
    { merge: true },
  )
  return c.json({ ok: true })
})

/** DELETE /agents/:agentId/skills/:skillId — detach. Skill-owned data is left intact. */
skills.delete('/:skillId', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const skillId = c.req.param('skillId')
  if (!isSkillId(skillId)) return c.json({ error: 'Unknown skill.' }, 404)
  await adminDb.doc(`workspaces/${ws}/agents/${agentId}/skills/${skillId}`).delete()
  return c.json({ ok: true })
})

export default skills
