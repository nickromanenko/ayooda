import { Hono } from 'hono'
import { adminDb, adminAuth } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const user = new Hono<{ Variables: AuthVariables }>()

user.use('*', requireAuth)

/** GET /user — current user's profile */
user.get('/', async (c) => {
  const uid = c.get('uid')
  const snap = await adminDb.doc(`users/${uid}`).get()
  if (!snap.exists) return c.json({ error: 'User not found' }, 404)
  const data = snap.data()!
  return c.json({
    email: data.email,
    displayName: data.displayName ?? '',
    photoURL: data.photoURL ?? null,
  })
})

/** PUT /user — update display name (Firestore + Firebase Auth) */
user.put('/', async (c) => {
  const uid = c.get('uid')
  const body = await c.req.json<{ displayName?: string }>()
  const displayName = body.displayName?.trim()
  if (!displayName || displayName.length > 80) {
    return c.json({ error: 'displayName is required (max 80 chars)' }, 400)
  }
  await adminDb.doc(`users/${uid}`).update({ displayName, displayNameLower: displayName.toLowerCase(), updatedAt: new Date() })
  await adminAuth.updateUser(uid, { displayName })
  return c.json({ ok: true })
})

export default user
