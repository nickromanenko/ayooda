import { createMiddleware } from 'hono/factory'
import { canEditAgent } from '@ayooda/shared'
import { adminDb } from '../lib/firebase-admin'
import type { AuthVariables } from './auth'

/**
 * Loads workspaces/{ws}/agents/{agentId} and gates access to it.
 *
 * 404 if the agent is not in the caller's workspace; 403 if it is but they may
 * not configure it. Owners may configure every agent; a member only the agents
 * they have been granted. Run AFTER requireAuth.
 *
 * This replaces requireOwner on the agent-scoped routers — the check has to see
 * the agent document, and this middleware already loads it.
 */
export const requireAgent = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const ws = c.get('workspaceId')
  const agentId = c.req.param('agentId')
  if (!agentId) return c.json({ error: 'Agent not found' }, 404)

  const snap = await adminDb.doc(`workspaces/${ws}/agents/${agentId}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)

  const data = snap.data()!
  if (!canEditAgent(c.get('role'), data.editorUids as string[] | undefined, c.get('uid'))) {
    return c.json({ error: 'You do not have access to this agent' }, 403)
  }

  c.set('agentId', agentId)
  c.set('agentNamespace', (data.knowledgeNamespace as string) ?? `ws_${ws}`)
  await next()
})
