import { FieldValue } from 'firebase-admin/firestore'
import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { normalizeInviteEmail } from '../lib/team/invite'

const team = new Hono<{ Variables: AuthVariables }>()

team.use('*', requireAuth)
team.use('*', requireOwner)

/** GET /team — members + pending invites for the workspace */
team.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const [usersSnap, invitesSnap] = await Promise.all([
    adminDb.collection('users').where('workspaceId', '==', workspaceId).get(),
    adminDb.collection('pendingInvites').where('workspaceId', '==', workspaceId).get(),
  ])
  const members = usersSnap.docs.map((d) => {
    const u = d.data()
    return { uid: d.id, email: u.email ?? '', displayName: u.displayName ?? '', role: u.role ?? 'owner' }
  })
  const invites = invitesSnap.docs.map((d) => {
    const i = d.data()
    return { email: i.email as string, createdAt: i.createdAt?.toDate?.() ?? null }
  })
  return c.json({ members, invites })
})

/** POST /team/invite { email } — create a pending invite */
team.post('/invite', async (c) => {
  const workspaceId = c.get('workspaceId')
  const uid = c.get('uid')
  const body = await c.req.json<{ email?: string }>()
  const result = normalizeInviteEmail(body.email ?? '')
  if (!result.ok) return c.json({ error: result.error }, 400)
  const email = result.email

  // Reject if a user with that email already exists
  const existingUser = await adminDb.collection('users').where('email', '==', email).limit(1).get()
  if (!existingUser.empty) {
    return c.json({ error: 'This email already has an Ayooda account.' }, 409)
  }
  // Reject if already invited (anywhere — one invite per email)
  const inviteRef = adminDb.doc(`pendingInvites/${email}`)
  if ((await inviteRef.get()).exists) {
    return c.json({ error: 'This email has already been invited.' }, 409)
  }

  await inviteRef.set({ email, workspaceId, invitedBy: uid, createdAt: new Date() })

  const base = process.env.WEB_PUBLIC_URL ?? ''
  return c.json({ email, inviteLink: `${base}/signup?invite=${encodeURIComponent(email)}` })
})

/** DELETE /team/invite/:email — revoke a pending invite (scoped to this workspace) */
team.delete('/invite/:email', async (c) => {
  const workspaceId = c.get('workspaceId')
  const email = c.req.param('email').trim().toLowerCase()
  const ref = adminDb.doc(`pendingInvites/${email}`)
  const snap = await ref.get()
  if (snap.exists && snap.data()!.workspaceId === workspaceId) {
    await ref.delete()
  }
  return c.json({ ok: true })
})

/** DELETE /team/member/:uid — remove a member (not the owner) */
team.delete('/member/:uid', async (c) => {
  const workspaceId = c.get('workspaceId')
  const targetUid = c.req.param('uid')
  const userRef = adminDb.doc(`users/${targetUid}`)
  const snap = await userRef.get()
  if (!snap.exists || snap.data()!.workspaceId !== workspaceId) {
    return c.json({ error: 'Member not found' }, 404)
  }
  // Never remove the workspace owner
  const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (wsSnap.data()?.ownerId === targetUid || snap.data()!.role === 'owner') {
    return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  }
  // Drop their per-agent access too, or a re-invited uid would silently regain
  // every agent it used to hold.
  const agentsSnap = await adminDb
    .collection(`workspaces/${workspaceId}/agents`)
    .where('editorUids', 'array-contains', targetUid)
    .get()
  for (const d of agentsSnap.docs) {
    await d.ref.update({ editorUids: FieldValue.arrayRemove(targetUid), updatedAt: new Date() })
  }

  await userRef.delete()
  return c.json({ ok: true })
})

export default team
