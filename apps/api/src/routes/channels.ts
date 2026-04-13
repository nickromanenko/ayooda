import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const channels = new Hono<{ Variables: AuthVariables }>()

channels.use('*', requireAuth)

const WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'https://ayooda-1791f.web.app'

/** GET /channels — list channels for this workspace */
channels.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .orderBy('createdAt', 'desc')
    .get()

  return c.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
})

/**
 * POST /channels/web-widget
 * Idempotent — returns existing channel if one already exists.
 * Also marks onboardingComplete = true on the workspace.
 */
channels.post('/web-widget', async (c) => {
  const workspaceId = c.get('workspaceId')

  // Get agent name for the widget config
  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const agentName = workspaceSnap.data()?.agent?.name ?? 'Support Agent'
  const agentPhotoURL = workspaceSnap.data()?.agent?.photoURL ?? null

  // Check if a web_widget channel already exists
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .where('type', '==', 'web_widget')
    .limit(1)
    .get()

  if (!existing.empty) {
    const ch = existing.docs[0]
    return c.json({ channelId: ch.id, embedCode: ch.data().embedCode })
  }

  const channelRef = adminDb.collection(`workspaces/${workspaceId}/channels`).doc()
  const channelId = channelRef.id
  const embedCode = `<script src="${WIDGET_BASE_URL}/widget.js" data-agent-id="${channelId}" async></script>`

  const batch = adminDb.batch()

  batch.set(channelRef, {
    // Store workspaceId + id as fields so widget routes can look up by channelId
    workspaceId,
    id: channelId,
    type: 'web_widget',
    config: {
      widgetColor: '#6366f1',
      widgetPosition: 'bottom-right',
      welcomeMessage: `Hi there! How can ${agentName} help you today?`,
      agentName,
      agentPhotoURL,
    },
    embedCode,
    isActive: true,
    createdAt: new Date(),
  })

  // Mark onboarding as complete
  batch.update(adminDb.doc(`workspaces/${workspaceId}`), {
    onboardingComplete: true,
  })

  await batch.commit()

  return c.json({ channelId, embedCode }, 201)
})

export default channels
