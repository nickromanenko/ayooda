import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { LEGACY_MODEL_MAP } from '../lib/gemini'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { GEMINI_MODELS, type GeminiModelId } from '@ayooda/shared'

const workspace = new Hono<{ Variables: AuthVariables }>()

workspace.use('*', requireAuth)

/** GET /workspace — fetch workspace + agent config */
workspace.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!snap.exists) return c.json({ error: 'Workspace not found' }, 404)

  const data = snap.data()!
  // Never return llmApiKey (field removed in v1, kept for safety)
  return c.json({
    id: workspaceId,
    name: data.name,
    onboardingComplete: data.onboardingComplete ?? false,
    agent: {
      name: data.agent.name,
      photoURL: data.agent.photoURL,
      description: data.agent.description,
      systemPrompt: data.agent.systemPrompt,
      llmModel: LEGACY_MODEL_MAP[data.agent.llmModel] ?? data.agent.llmModel,
    },
    usage: data.usage,
  })
})

/** PUT /workspace — rename the workspace */
workspace.put('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name || name.length > 80) {
    return c.json({ error: 'name is required (max 80 chars)' }, 400)
  }
  await adminDb.doc(`workspaces/${workspaceId}`).update({ name })
  return c.json({ ok: true })
})

/** PUT /workspace/agent — update agent identity & model */
workspace.put('/agent', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{
    name?: string
    description?: string
    systemPrompt?: string
    llmModel?: GeminiModelId
  }>()

  if (body.llmModel !== undefined && !GEMINI_MODELS.some((m) => m.id === body.llmModel)) {
    return c.json({ error: 'Invalid llmModel' }, 400)
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update['agent.name'] = body.name
  if (body.description !== undefined) update['agent.description'] = body.description
  if (body.systemPrompt !== undefined) update['agent.systemPrompt'] = body.systemPrompt
  if (body.llmModel !== undefined) update['agent.llmModel'] = body.llmModel

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  await adminDb.doc(`workspaces/${workspaceId}`).update(update)
  return c.json({ ok: true })
})

export default workspace
