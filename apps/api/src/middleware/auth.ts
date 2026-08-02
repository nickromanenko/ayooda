import { createMiddleware } from 'hono/factory'
import type { WorkspaceRole } from '@ayooda/shared'
import { adminAuth, adminDb } from '../lib/firebase-admin'

export type AuthVariables = {
  uid: string
  workspaceId: string
  role: WorkspaceRole
  agentId?: string
  agentNamespace?: string
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authorization.slice(7)
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    const userDoc = await adminDb.doc(`users/${decoded.uid}`).get()
    if (!userDoc.exists) {
      return c.json({ error: 'User not found' }, 404)
    }
    const userData = userDoc.data()!
    c.set('uid', decoded.uid)
    c.set('workspaceId', userData.workspaceId)
    c.set('role', (userData.role as WorkspaceRole) ?? 'owner')
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

/** Gate a route to workspace owners. Must run AFTER requireAuth. */
export const requireOwner = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.get('role') !== 'owner') {
    return c.json({ error: 'Owner access required' }, 403)
  }
  await next()
})
