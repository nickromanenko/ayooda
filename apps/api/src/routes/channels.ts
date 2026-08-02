import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { encryptSecret } from '../lib/crypto'
import { getMe, setWebhook, deleteWebhook } from '../lib/telegram/client'

const channels = new Hono<{ Variables: AuthVariables }>()

channels.use('*', requireAuth)
channels.use('*', requireOwner)

const WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'https://ayooda-1791f.web.app'

async function defaultAgent(workspaceId: string): Promise<{ id: string; name: string; photoURL: string | null } | null> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/agents`).where('isDefault', '==', true).limit(1).get()
  if (snap.empty) return null
  const d = snap.docs[0]!
  return { id: d.id, name: d.data().name ?? 'Support Agent', photoURL: d.data().photoURL ?? null }
}

/** GET /channels — list channels for this workspace */
channels.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .orderBy('createdAt', 'desc')
    .get()

  return c.json(snap.docs.map((d) => {
    const { botTokenEnc, webhookSecret, ...safe } = d.data() as Record<string, unknown>
    return { id: d.id, ...safe }
  }))
})

/**
 * POST /channels/web-widget
 * Idempotent — returns existing channel if one already exists.
 * Also marks onboardingComplete = true on the workspace.
 */
channels.post('/web-widget', async (c) => {
  const workspaceId = c.get('workspaceId')

  // Get agent name for the widget config (default agent, fallback inline)
  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const agent = await defaultAgent(workspaceId)
  const agentName = agent?.name ?? workspaceSnap.data()?.agent?.name ?? 'Support Agent'
  const agentPhotoURL = agent?.photoURL ?? workspaceSnap.data()?.agent?.photoURL ?? null

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
    agentId: agent?.id ?? null,
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

/** POST /channels/telegram — connect a workspace's Telegram bot */
channels.post('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ botToken?: string }>()
  const botToken = body.botToken?.trim()
  if (!botToken) return c.json({ error: 'botToken is required' }, 400)

  const apiBase = process.env.API_PUBLIC_URL
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  // Validate the token
  let bot
  try {
    bot = await getMe(botToken)
  } catch {
    return c.json({ error: 'Invalid bot token' }, 400)
  }

  // One telegram channel per workspace: reuse the existing doc id if present
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .where('type', '==', 'telegram')
    .limit(1)
    .get()
  const channelRef = existing.empty
    ? adminDb.collection(`workspaces/${workspaceId}/channels`).doc()
    : existing.docs[0].ref
  const channelId = channelRef.id
  const webhookSecret = randomBytes(24).toString('hex')
  const agent = await defaultAgent(workspaceId)

  // Write the channel doc FIRST
  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'telegram',
    agentId: agent?.id ?? null,
    botTokenEnc: encryptSecret(botToken),
    webhookSecret,
    telegram: { botUsername: bot.username, botId: bot.id },
    isActive: true,
    createdAt: new Date(),
  })

  // THEN register the webhook, rolling back on failure
  try {
    await setWebhook(botToken, `${apiBase}/telegram/webhook/${channelId}`, webhookSecret)
  } catch {
    await channelRef.delete().catch(() => {})
    return c.json({ error: 'Could not register the Telegram webhook. Check the token and try again.' }, 502)
  }

  return c.json({ channelId, botUsername: bot.username })
})

/** DELETE /channels/telegram — disconnect the bot */
channels.delete('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .where('type', '==', 'telegram')
    .limit(1)
    .get()
  if (existing.empty) return c.json({ ok: true })

  const doc = existing.docs[0]
  const enc = doc.data().botTokenEnc as string | undefined
  if (enc) {
    try {
      const { decryptSecret } = await import('../lib/crypto')
      await deleteWebhook(decryptSecret(enc))
    } catch (err) {
      console.warn('[channels/telegram] deleteWebhook failed:', err)
    }
  }
  await doc.ref.delete()
  return c.json({ ok: true })
})

/** PUT /channels/:id/agent — assign which agent answers on this channel. */
channels.put('/:id/agent', async (c) => {
  const workspaceId = c.get('workspaceId')
  const channelId = c.req.param('id')
  const body = await c.req.json<{ agentId?: string }>().catch(() => ({} as { agentId?: string }))
  const agentId = body.agentId
  if (!agentId) return c.json({ error: 'agentId is required' }, 400)

  const agentSnap = await adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}`).get()
  if (!agentSnap.exists) return c.json({ error: 'Agent not found' }, 404)
  const channelRef = adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`)
  const channelSnap = await channelRef.get()
  if (!channelSnap.exists) return c.json({ error: 'Channel not found' }, 404)

  const a = agentSnap.data()!
  const update: Record<string, unknown> = { agentId }
  // Refresh the cached widget identity so the visitor sees the assigned agent.
  if (channelSnap.data()!.type === 'web_widget') {
    update['config.agentName'] = a.name ?? 'Support Agent'
    update['config.agentPhotoURL'] = a.photoURL ?? null
  }
  await channelRef.update(update)
  return c.json({ ok: true })
})

export default channels
