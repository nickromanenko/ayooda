import { Hono } from 'hono'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { LEGACY_MODEL_MAP } from '../lib/gemini'
import { encryptSecret } from '../lib/crypto'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { LLM_MODELS } from '@ayooda/shared'

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
    hasOpenRouterKey: Boolean(data.openRouterKey),
    role: c.get('role'),
  })
})

/** PUT /workspace — rename the workspace */
workspace.put('/', requireOwner, async (c) => {
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
workspace.put('/agent', requireOwner, async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{
    name?: string
    description?: string
    systemPrompt?: string
    llmModel?: string
  }>()

  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) {
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

/** PUT /workspace/key — store the workspace's OpenRouter API key (encrypted) */
workspace.put('/key', requireOwner, async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ apiKey?: string }>()
  const apiKey = body.apiKey?.trim()
  if (!apiKey || apiKey.length > 500) {
    return c.json({ error: 'apiKey is required (max 500 chars)' }, 400)
  }
  await adminDb.doc(`workspaces/${workspaceId}`).update({ openRouterKey: encryptSecret(apiKey) })
  return c.json({ ok: true })
})

/** DELETE /workspace/key — remove the stored key */
workspace.delete('/key', requireOwner, async (c) => {
  const workspaceId = c.get('workspaceId')
  await adminDb.doc(`workspaces/${workspaceId}`).update({ openRouterKey: FieldValue.delete() })
  return c.json({ ok: true })
})

export default workspace
