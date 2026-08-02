import { createMiddleware } from 'hono/factory'
import { adminDb } from '../lib/firebase-admin'
import type { AuthVariables } from './auth'

/** Loads workspaces/{ws}/agents/{agentId}; 404 if not in the caller's workspace.
 * Sets agentId + agentNamespace. Run AFTER requireAuth (+ requireOwner). */
export const requireAgent = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const ws = c.get('workspaceId')
  const agentId = c.req.param('agentId')
  if (!agentId) return c.json({ error: 'Agent not found' }, 404)
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${agentId}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  c.set('agentId', agentId)
  c.set('agentNamespace', (snap.data()!.knowledgeNamespace as string) ?? `ws_${ws}`)
  await next()
})
