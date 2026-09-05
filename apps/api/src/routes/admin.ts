import { Hono, type Context } from 'hono'
import { AggregateField, FieldPath, type DocumentData, type Query } from 'firebase-admin/firestore'
import type {
  AdminListResponse,
  AdminOverview,
  AdminOverviewMetric,
  AdminUserSummary,
  AdminWorkspaceDetail,
  AdminWorkspaceSummary,
} from '@ayooda/shared'
import { adminAuth, adminDb } from '../lib/firebase-admin'
import { requireAuth, requirePlatformAdmin, type AuthVariables } from '../middleware/auth'
import { rateLimit } from '../lib/rate-limit'
import { tryWriteAdminAuditEvent } from '../lib/admin/audit'
import { adminPageLimit, decodeAdminCursor, encodeAdminCursor, normalizedAdminQuery } from '../lib/admin/pagination'
import { serializeAdminAudit, serializeAdminUser, serializeAdminWorkspace } from '../lib/admin/serialize'

const admin = new Hono<{ Variables: AuthVariables }>()
admin.use('*', requireAuth)
admin.use('*', requirePlatformAdmin)
admin.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})

const safeId = (value: string) => /^[A-Za-z0-9_-]{1,256}$/.test(value)

async function authStateByUid(uids: string[]) {
  if (uids.length === 0) return new Map<string, { disabled: boolean; lastSignInTime: string | null }>()
  try {
    const result = await adminAuth.getUsers(uids.map((uid) => ({ uid })))
    return new Map(result.users.map((record) => [record.uid, {
      disabled: record.disabled,
      lastSignInTime: record.metadata.lastSignInTime ?? null,
    }]))
  } catch (error) {
    console.error('[admin/users] Firebase account state unavailable', error)
    return new Map<string, { disabled: boolean; lastSignInTime: string | null }>()
  }
}

async function hydrateUsers(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<AdminUserSummary[]> {
  const workspaceIds = [...new Set(docs.map((doc) => String(doc.data().workspaceId ?? '')).filter(Boolean))]
  const [workspaceDocs, authStates] = await Promise.all([
    workspaceIds.length ? adminDb.getAll(...workspaceIds.map((id) => adminDb.doc(`workspaces/${id}`))) : [],
    authStateByUid(docs.map((doc) => doc.id)),
  ])
  const names = new Map(workspaceDocs.map((doc) => [doc.id, String(doc.data()?.name ?? '')]))
  return docs.map((doc) => serializeAdminUser(
    doc.id,
    doc.data(),
    names.get(String(doc.data().workspaceId ?? '')) ?? '',
    authStates.get(doc.id),
  ))
}

async function hydrateWorkspaces(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<AdminWorkspaceSummary[]> {
  const ownerIds = [...new Set(docs.map((doc) => String(doc.data().ownerId ?? '')).filter(Boolean))]
  const owners = ownerIds.length ? await adminDb.getAll(...ownerIds.map((id) => adminDb.doc(`users/${id}`))) : []
  const emails = new Map(owners.map((doc) => [doc.id, String(doc.data()?.email ?? '')]))
  return docs.map((doc) => serializeAdminWorkspace(doc.id, doc.data(), emails.get(String(doc.data().ownerId ?? '')) ?? ''))
}

async function metric<T>(promise: Promise<T>, select: (value: T) => number): Promise<AdminOverviewMetric> {
  try {
    return { value: select(await promise) }
  } catch (error) {
    console.error('[admin/overview] metric unavailable', error)
    return { value: null, unavailable: true }
  }
}

admin.get('/overview', async (c) => {
  const now = Date.now()
  const users = adminDb.collection('users')
  const workspaces = adminDb.collection('workspaces')
  const [
    userCount, workspaceCount, signups7d, signups30d, activeSubscriptions,
    trialingSubscriptions, pastDueSubscriptions, periodConversations, totalTokens, recentUserSnap, recentWorkspaceSnap,
  ] = await Promise.all([
    metric(users.count().get(), (value) => value.data().count),
    metric(workspaces.count().get(), (value) => value.data().count),
    metric(users.where('createdAt', '>=', new Date(now - 7 * 86_400_000)).count().get(), (value) => value.data().count),
    metric(users.where('createdAt', '>=', new Date(now - 30 * 86_400_000)).count().get(), (value) => value.data().count),
    metric(workspaces.where('subscription.status', '==', 'active').count().get(), (value) => value.data().count),
    metric(workspaces.where('subscription.status', '==', 'trialing').count().get(), (value) => value.data().count),
    metric(workspaces.where('subscription.status', '==', 'past_due').count().get(), (value) => value.data().count),
    metric(workspaces.aggregate({ value: AggregateField.sum('usage.periodConversationCount') }).get(), (result) => Number(result.data().value ?? 0)),
    metric(workspaces.aggregate({ value: AggregateField.sum('usage.tokenCount') }).get(), (result) => Number(result.data().value ?? 0)),
    users.orderBy('createdAt', 'desc').limit(5).get().catch(() => null),
    workspaces.orderBy('createdAt', 'desc').limit(5).get().catch(() => null),
  ])

  const body: AdminOverview = {
    metrics: {
      users: userCount,
      workspaces: workspaceCount,
      signups7d,
      signups30d,
      activeSubscriptions,
      trialingSubscriptions,
      pastDueSubscriptions,
      periodConversations,
      totalTokens,
    },
    recentUsers: recentUserSnap ? await hydrateUsers(recentUserSnap.docs).catch(() => []) : [],
    recentWorkspaces: recentWorkspaceSnap ? await hydrateWorkspaces(recentWorkspaceSnap.docs).catch(() => []) : [],
  }
  return c.json(body)
})

admin.get('/users', async (c) => {
  const limit = adminPageLimit(c.req.query('limit'))
  const rawSearch = (c.req.query('query') ?? '').trim().slice(0, 100)
  const search = normalizedAdminQuery(c.req.query('query'))
  const status = c.req.query('status')
  const platformRole = c.req.query('platformRole')
  const rawCursor = c.req.query('cursor')
  const cursorId = decodeAdminCursor(rawCursor)
  if (rawCursor && !cursorId) return c.json({ error: 'Invalid cursor' }, 400)
  if (status && status !== 'active' && status !== 'disabled') return c.json({ error: 'Invalid status filter' }, 400)
  if (platformRole && platformRole !== 'admin') return c.json({ error: 'Invalid platform role filter' }, 400)

  if (rawSearch && safeId(rawSearch)) {
    const direct = await adminDb.doc(`users/${rawSearch}`).get()
    if (direct.exists) {
      const fakeDocs = [direct as FirebaseFirestore.QueryDocumentSnapshot]
      const items = (await hydrateUsers(fakeDocs)).filter((user) =>
        (!status || user.accessStatus === status) && (!platformRole || user.platformRole === platformRole))
      return c.json({ items, nextCursor: null } satisfies AdminListResponse<AdminUserSummary>)
    }
  }

  let query: Query<DocumentData> = adminDb.collection('users')
  if (status) query = query.where('accessStatus', '==', status)
  if (platformRole) query = query.where('platformRole', '==', platformRole)
  if (search) {
    const field = search.includes('@') ? 'emailLower' : 'displayNameLower'
    query = query.orderBy(field)
    if (!cursorId) query = query.startAt(search)
    query = query.endAt(`${search}\uf8ff`)
  } else {
    query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
  }
  if (cursorId) {
    const cursor = await adminDb.doc(`users/${cursorId}`).get()
    if (!cursor.exists) return c.json({ error: 'Cursor no longer exists' }, 400)
    query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(limit + 1).get()
  const hasMore = snapshot.size > limit
  const docs = snapshot.docs.slice(0, limit)
  return c.json({
    items: await hydrateUsers(docs),
    nextCursor: hasMore && docs.at(-1) ? encodeAdminCursor(docs.at(-1)!.id) : null,
  } satisfies AdminListResponse<AdminUserSummary>)
})

admin.get('/users/:uid', async (c) => {
  const uid = c.req.param('uid') ?? ''
  if (!safeId(uid)) return c.json({ error: 'Invalid user id' }, 400)
  const snap = await adminDb.doc(`users/${uid}`).get()
  if (!snap.exists) return c.json({ error: 'User not found' }, 404)
  const workspaceId = String(snap.data()!.workspaceId ?? '')
  const [workspace, authRecord] = await Promise.all([
    workspaceId && safeId(workspaceId) ? adminDb.doc(`workspaces/${workspaceId}`).get() : Promise.resolve(null),
    adminAuth.getUser(uid).catch(() => null),
  ])
  return c.json(serializeAdminUser(uid, snap.data()!, String(workspace?.data()?.name ?? ''), authRecord ? {
    disabled: authRecord.disabled,
    lastSignInTime: authRecord.metadata.lastSignInTime,
  } : undefined))
})

async function performUserAction(c: Context<{ Variables: AuthVariables }>, action: 'disable' | 'enable' | 'revoke_sessions') {
  const uid = c.req.param('uid') ?? ''
  if (!safeId(uid)) return c.json({ error: 'Invalid user id' }, 400)
  if (action === 'disable' && uid === c.get('uid')) return c.json({ error: 'You cannot disable your own account' }, 400)
  const limited = rateLimit(`admin-user-action:${c.get('uid')}`, 20, 60_000)
  if (!limited.ok) return c.json({ error: 'Too many administrative actions. Try again shortly.' }, 429)

  const ref = adminDb.doc(`users/${uid}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'User not found' }, 404)
  const targetEmail = String(snap.data()!.email ?? '')

  try {
    if (action === 'disable') {
      await adminAuth.updateUser(uid, { disabled: true })
      await adminAuth.revokeRefreshTokens(uid)
      await ref.update({ accessStatus: 'disabled', disabledAt: new Date(), disabledBy: c.get('uid'), updatedAt: new Date() })
    } else if (action === 'enable') {
      await adminAuth.updateUser(uid, { disabled: false })
      await ref.update({ accessStatus: 'active', disabledAt: null, disabledBy: null, updatedAt: new Date() })
    } else {
      await adminAuth.revokeRefreshTokens(uid)
    }
    await tryWriteAdminAuditEvent({
      actorUid: c.get('uid'), actorEmail: c.get('email'), action: `user.${action}`,
      targetType: 'user', targetId: uid, outcome: 'succeeded',
      summary: `${action === 'disable' ? 'Disabled' : action === 'enable' ? 'Enabled' : 'Revoked sessions for'} ${targetEmail || uid}.`,
      metadata: { targetEmail: targetEmail || null },
    })
    const refreshed = await ref.get()
    const authRecord = await adminAuth.getUser(uid).catch(() => null)
    return c.json(serializeAdminUser(uid, refreshed.data()!, '', authRecord ? {
      disabled: authRecord.disabled,
      lastSignInTime: authRecord.metadata.lastSignInTime,
    } : undefined))
  } catch (error) {
    console.error('[admin/users] action failed', { action, uid, error })
    await tryWriteAdminAuditEvent({
      actorUid: c.get('uid'), actorEmail: c.get('email'), action: `user.${action}`,
      targetType: 'user', targetId: uid, outcome: 'failed',
      summary: `Failed to ${action.replace('_', ' ')} ${targetEmail || uid}.`, metadata: { targetEmail: targetEmail || null },
    })
    return c.json({ error: 'The account action could not be completed.' }, 500)
  }
}

admin.post('/users/:uid/disable', (c) => performUserAction(c, 'disable'))
admin.post('/users/:uid/enable', (c) => performUserAction(c, 'enable'))
admin.post('/users/:uid/revoke-sessions', (c) => performUserAction(c, 'revoke_sessions'))

admin.get('/workspaces', async (c) => {
  const limit = adminPageLimit(c.req.query('limit'))
  const rawSearch = (c.req.query('query') ?? '').trim().slice(0, 100)
  const search = normalizedAdminQuery(c.req.query('query'))
  const subscriptionStatus = c.req.query('subscriptionStatus')
  const tier = c.req.query('tier')
  const rawCursor = c.req.query('cursor')
  const cursorId = decodeAdminCursor(rawCursor)
  if (rawCursor && !cursorId) return c.json({ error: 'Invalid cursor' }, 400)
  if (subscriptionStatus && !['trialing', 'active', 'past_due', 'canceled', 'expired'].includes(subscriptionStatus)) return c.json({ error: 'Invalid subscription filter' }, 400)
  if (tier && !['lite', 'core', 'max'].includes(tier)) return c.json({ error: 'Invalid tier filter' }, 400)

  if (rawSearch && safeId(rawSearch)) {
    const direct = await adminDb.doc(`workspaces/${rawSearch}`).get()
    if (direct.exists) {
      const items = (await hydrateWorkspaces([direct as FirebaseFirestore.QueryDocumentSnapshot])).filter((workspace) =>
        (!subscriptionStatus || workspace.subscriptionStatus === subscriptionStatus) && (!tier || workspace.tier === tier))
      return c.json({ items, nextCursor: null } satisfies AdminListResponse<AdminWorkspaceSummary>)
    }
  }

  let query: Query<DocumentData> = adminDb.collection('workspaces')
  if (subscriptionStatus) query = query.where('subscription.status', '==', subscriptionStatus)
  if (tier) query = query.where('subscription.tier', '==', tier)
  if (search) {
    query = query.orderBy('nameLower')
    if (!cursorId) query = query.startAt(search)
    query = query.endAt(`${search}\uf8ff`)
  }
  else query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
  if (cursorId) {
    const cursor = await adminDb.doc(`workspaces/${cursorId}`).get()
    if (!cursor.exists) return c.json({ error: 'Cursor no longer exists' }, 400)
    query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(limit + 1).get()
  const hasMore = snapshot.size > limit
  const docs = snapshot.docs.slice(0, limit)
  return c.json({
    items: await hydrateWorkspaces(docs),
    nextCursor: hasMore && docs.at(-1) ? encodeAdminCursor(docs.at(-1)!.id) : null,
  } satisfies AdminListResponse<AdminWorkspaceSummary>)
})

admin.get('/workspaces/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  if (!safeId(workspaceId)) return c.json({ error: 'Invalid workspace id' }, 400)
  const ref = adminDb.doc(`workspaces/${workspaceId}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Workspace not found' }, 404)
  const membersQuery = adminDb.collection('users').where('workspaceId', '==', workspaceId)
  const [membersSnap, agents, channels, conversations, tickets] = await Promise.all([
    membersQuery.get(),
    ref.collection('agents').count().get(),
    ref.collection('channels').count().get(),
    ref.collection('conversations').count().get(),
    ref.collection('tickets').count().get(),
  ])
  const users = await hydrateUsers(membersSnap.docs)
  const owner = users.find((user) => user.uid === String(snap.data()!.ownerId ?? ''))
  const summary = serializeAdminWorkspace(workspaceId, snap.data()!, owner?.email ?? '')
  const subscription = snap.data()!.subscription ?? {}
  const body: AdminWorkspaceDetail = {
    ...summary,
    members: users.map(({ uid, email, displayName, workspaceRole, accessStatus }) => ({ uid, email, displayName, workspaceRole, accessStatus })),
    counts: {
      members: membersSnap.size,
      agents: agents.data().count,
      channels: channels.data().count,
      conversations: conversations.data().count,
      tickets: tickets.data().count,
    },
    stripeCustomerId: typeof subscription.stripeCustomerId === 'string' ? subscription.stripeCustomerId : null,
    stripeSubscriptionId: typeof subscription.stripeSubscriptionId === 'string' ? subscription.stripeSubscriptionId : null,
  }
  return c.json(body)
})

admin.get('/audit-log', async (c) => {
  const limit = adminPageLimit(c.req.query('limit'))
  const rawCursor = c.req.query('cursor')
  const cursorId = decodeAdminCursor(rawCursor)
  if (rawCursor && !cursorId) return c.json({ error: 'Invalid cursor' }, 400)
  let query: Query<DocumentData> = adminDb.collection('adminAuditLogs')
  const actorUid = c.req.query('actorUid')
  const action = c.req.query('action')
  const targetId = c.req.query('targetId')
  const filterCount = [actorUid, action, targetId].filter(Boolean).length
  if (filterCount > 1 && !(filterCount === 2 && action && targetId)) return c.json({ error: 'Combine only action and target filters.' }, 400)
  if (actorUid) query = query.where('actorUid', '==', actorUid.slice(0, 256))
  if (action) query = query.where('action', '==', action.slice(0, 100))
  if (targetId) query = query.where('targetId', '==', targetId.slice(0, 256))
  query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
  if (cursorId) {
    const cursor = await adminDb.doc(`adminAuditLogs/${cursorId}`).get()
    if (!cursor.exists) return c.json({ error: 'Cursor no longer exists' }, 400)
    query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(limit + 1).get()
  const hasMore = snapshot.size > limit
  const docs = snapshot.docs.slice(0, limit)
  return c.json({
    items: docs.map((doc) => serializeAdminAudit(doc.id, doc.data())),
    nextCursor: hasMore && docs.at(-1) ? encodeAdminCursor(docs.at(-1)!.id) : null,
  })
})

export default admin
