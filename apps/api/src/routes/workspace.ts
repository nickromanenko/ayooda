import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { LEGACY_MODEL_MAP } from '../lib/gemini'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'

const workspace = new Hono<{ Variables: AuthVariables }>()

workspace.use('*', requireAuth)

/** GET /workspace — fetch workspace + agent config */
workspace.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!snap.exists) return c.json({ error: 'Workspace not found' }, 404)

  const data = snap.data()!
  // Source the agent from the workspace's default agent (fallback to the inline copy).
  const agentsSnap = await adminDb.collection(`workspaces/${workspaceId}/agents`).where('isDefault', '==', true).limit(1).get()
  const defAgent = agentsSnap.empty ? null : agentsSnap.docs[0]!.data()
  const agentSource = defAgent ?? data.agent ?? {}
  return c.json({
    id: workspaceId,
    name: data.name,
    onboardingComplete: data.onboardingComplete ?? false,
    agent: {
      name: agentSource.name,
      photoURL: agentSource.photoURL ?? null,
      description: agentSource.description ?? '',
      systemPrompt: agentSource.systemPrompt ?? '',
      llmModel: LEGACY_MODEL_MAP[agentSource.llmModel] ?? agentSource.llmModel,
    },
    usage: data.usage,
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
  await adminDb.doc(`workspaces/${workspaceId}`).update({ name, nameLower: name.toLowerCase(), updatedAt: new Date() })
  return c.json({ ok: true })
})

export default workspace
