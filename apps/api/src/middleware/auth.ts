import { createMiddleware } from 'hono/factory'
import type { PlatformRole, UserAccessStatus, WorkspaceRole } from '@ayooda/shared'
import { adminAuth, adminDb } from '../lib/firebase-admin'

export type AuthVariables = {
  uid: string
  workspaceId: string
  role: WorkspaceRole
  platformRole?: PlatformRole
  accessStatus: UserAccessStatus
  email: string
  agentId?: string
  agentNamespace?: string
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authorization.slice(7)
  let decoded
  try {
    decoded = await adminAuth.verifyIdToken(token, true)
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  const userDoc = await adminDb.doc(`users/${decoded.uid}`).get()
  if (!userDoc.exists) return c.json({ error: 'User not found' }, 404)

  const userData = userDoc.data()!
  if (userData.accessStatus === 'disabled') {
    return c.json({ error: 'Account disabled' }, 403)
  }
  if (typeof userData.workspaceId !== 'string' || !userData.workspaceId) {
    return c.json({ error: 'Account is not assigned to a workspace' }, 403)
  }

  c.set('uid', decoded.uid)
  c.set('workspaceId', userData.workspaceId)
  c.set('role', (userData.role as WorkspaceRole) ?? 'owner')
  c.set('platformRole', userData.platformRole === 'admin' ? 'admin' : undefined)
  c.set('accessStatus', 'active')
  c.set('email', typeof userData.email === 'string' ? userData.email : decoded.email ?? '')
  await next()
})

/** Gate a route to workspace owners. Must run AFTER requireAuth. */
export const requireOwner = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.get('role') !== 'owner') {
    return c.json({ error: 'Owner access required' }, 403)
  }
  await next()
})

/** Gate a route to Ayooda platform administrators. Must run AFTER requireAuth. */
export const requirePlatformAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (c.get('platformRole') !== 'admin') {
    return c.json({ error: 'Platform administrator access required' }, 403)
  }
  await next()
})
