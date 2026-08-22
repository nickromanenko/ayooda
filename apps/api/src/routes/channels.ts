import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'

const channels = new Hono<{ Variables: AuthVariables }>()

channels.use('*', requireAuth)
channels.use('*', requireOwner)

/**
 * GET /channels — every channel in the workspace, newest first.
 *
 * Creating and removing channels lives under the agent that owns them
 * (/agents/:agentId/channels); this workspace-wide list exists only so the
 * Overview can show where each agent is live.
 *
 * The agent's name and photo are resolved live from the agent doc rather than
 * from the channel's cached `config` copy — renaming an agent must not leave
 * the dashboard showing a stale name. The cache remains the fallback for a
 * channel whose agent has since been deleted.
 */
channels.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')

  const [snap, agentsSnap] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/channels`).orderBy('createdAt', 'desc').get(),
    adminDb.collection(`workspaces/${workspaceId}/agents`).get(),
  ])

  const agents = new Map(agentsSnap.docs.map((d) => [d.id, d.data()]))

  return c.json(snap.docs.map((d) => {
    const { botTokenEnc, webhookSecret, ...safe } = d.data() as Record<string, unknown>
    const config = (safe.config ?? {}) as Record<string, unknown>
    const agent = typeof safe.agentId === 'string' ? agents.get(safe.agentId) : undefined
    return {
      id: d.id,
      ...safe,
      config: {
        ...config,
        agentName: agent?.name ?? config.agentName ?? 'Support Agent',
        agentPhotoURL: agent?.photoURL ?? config.agentPhotoURL ?? null,
      },
    }
  }))
})

export default channels
