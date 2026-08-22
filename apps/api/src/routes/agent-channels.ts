import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { getMe, setWebhook, deleteWebhook } from '../lib/telegram/client'
import { validateWidgetAppearance } from '../lib/channels/validate'
import { DEFAULT_WIDGET_COLOR, DEFAULT_WIDGET_POSITION } from '@ayooda/shared'
import { canHideBranding } from '../lib/channels/branding'

/**
 * Channels belong to the agent that answers on them. Each agent gets its own
 * web widget (its own embed snippet) and can connect its own Telegram bot, so
 * a workspace with three agents can deploy all three independently.
 */
const agentChannels = new Hono<{ Variables: AuthVariables }>()

agentChannels.use('*', requireAuth)
agentChannels.use('*', requireOwner)
agentChannels.use('*', requireAgent)

const WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'https://ayooda-1791f.web.app'

const channelsCol = (workspaceId: string) =>
  adminDb.collection(`workspaces/${workspaceId}/channels`)

/** This agent's channel of a given type, or null. */
async function channelOfType(workspaceId: string, agentId: string, type: 'web_widget' | 'telegram') {
  const snap = await channelsCol(workspaceId)
    .where('agentId', '==', agentId)
    .where('type', '==', type)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]!
}

/** Whether this workspace's plan allows hiding the "Powered by Ayooda" line. */
async function workspaceCanHideBranding(workspaceId: string): Promise<boolean> {
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  return canHideBranding(snap.data()?.subscription)
}

async function agentIdentity(workspaceId: string, agentId: string) {
  const snap = await adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}`).get()
  const d = snap.data() ?? {}
  return {
    name: (d.name as string) ?? 'Support Agent',
    photoURL: (d.photoURL as string | null) ?? null,
  }
}

function strip(d: Record<string, unknown>) {
  const { botTokenEnc, webhookSecret, ...safe } = d
  return safe
}

/** GET /agents/:agentId/channels — where this agent is deployed. */
agentChannels.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const [snap, identity, canHide] = await Promise.all([
    channelsCol(workspaceId).where('agentId', '==', agentId).get(),
    agentIdentity(workspaceId, agentId),
    workspaceCanHideBranding(workspaceId),
  ])

  // Sorted in memory: ordering by createdAt alongside two equality filters would
  // need a composite index, and an agent has at most a handful of channels.
  const rows = snap.docs
    .map((d) => {
      const safe = strip(d.data() as Record<string, unknown>)
      const config = (safe.config ?? {}) as Record<string, unknown>
      // Same rule as the workspace-wide list: the agent's identity is read live,
      // never from the channel's cached copy, so a rename shows up immediately.
      return {
        id: d.id,
        ...safe,
        // Same shape as the skills catalogue: the row carries whether the plan
        // permits the option, so the UI can show it locked rather than hide it.
        brandingLocked: !canHide,
        config: {
          ...config,
          showBranding: config.showBranding !== false,
          agentName: identity.name,
          agentPhotoURL: identity.photoURL,
        },
      }
    })
    .sort((a, b) => {
      const at = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0
      const bt = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0
      return bt - at
    })

  return c.json(rows)
})

/**
 * POST /agents/:agentId/channels/web-widget — create this agent's widget.
 * Idempotent per agent: returns the existing widget if there is one.
 * Also marks the workspace's onboarding complete, since shipping a widget is
 * the last onboarding step.
 */
agentChannels.post('/web-widget', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const existing = await channelOfType(workspaceId, agentId, 'web_widget')
  if (existing) {
    return c.json({ channelId: existing.id, embedCode: existing.data().embedCode })
  }

  const { name: agentName, photoURL: agentPhotoURL } = await agentIdentity(workspaceId, agentId)

  const channelRef = channelsCol(workspaceId).doc()
  const channelId = channelRef.id
  const embedCode = `<script src="${WIDGET_BASE_URL}/widget.js" data-agent-id="${channelId}" async></script>`

  const batch = adminDb.batch()
  batch.set(channelRef, {
    // workspaceId + id are stored as fields so the public widget routes can
    // find the channel with a collection-group query.
    workspaceId,
    id: channelId,
    type: 'web_widget',
    agentId,
    config: {
      widgetColor: DEFAULT_WIDGET_COLOR,
      widgetPosition: DEFAULT_WIDGET_POSITION,
      welcomeMessage: `Hi there! How can ${agentName} help you today?`,
      showBranding: true,
      agentName,
      agentPhotoURL,
    },
    embedCode,
    isActive: true,
    createdAt: new Date(),
  })
  batch.update(adminDb.doc(`workspaces/${workspaceId}`), { onboardingComplete: true })
  await batch.commit()

  return c.json({ channelId, embedCode }, 201)
})

/**
 * PUT /agents/:agentId/channels/web-widget — how the widget looks on the
 * customer's site. Only appearance is writable here; the embed code and the
 * agent it answers as are derived, not set.
 */
agentChannels.put('/web-widget', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const existing = await channelOfType(workspaceId, agentId, 'web_widget')
  if (!existing) return c.json({ error: 'This agent has no widget yet.' }, 404)

  const result = validateWidgetAppearance(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)

  if (!result.value.showBranding && !(await workspaceCanHideBranding(workspaceId))) {
    return c.json(
      { error: 'Hiding the "Powered by Ayooda" line needs the Core plan or above.' },
      403,
    )
  }

  await existing.ref.update({
    'config.widgetColor': result.value.widgetColor,
    'config.widgetPosition': result.value.widgetPosition,
    'config.welcomeMessage': result.value.welcomeMessage,
    'config.showBranding': result.value.showBranding,
  })
  return c.json(result.value)
})

/** DELETE /agents/:agentId/channels/web-widget — take this agent off the web. */
agentChannels.delete('/web-widget', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const existing = await channelOfType(workspaceId, agentId, 'web_widget')
  if (existing) await existing.ref.delete()
  return c.json({ ok: true })
})

/** POST /agents/:agentId/channels/telegram — connect a bot to this agent. */
agentChannels.post('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const body = await c.req.json<{ botToken?: string }>().catch(() => ({} as { botToken?: string }))
  const botToken = body.botToken?.trim()
  if (!botToken) return c.json({ error: 'botToken is required' }, 400)

  const apiBase = process.env.API_PUBLIC_URL
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  let bot
  try {
    bot = await getMe(botToken)
  } catch {
    return c.json({ error: 'Invalid bot token' }, 400)
  }

  // A Telegram bot can only point its webhook at one place, so refuse to steal
  // a bot another agent is already using — that would silently break it.
  const claimed = await channelsCol(workspaceId)
    .where('type', '==', 'telegram')
    .where('telegram.botId', '==', bot.id)
    .limit(1)
    .get()
  const claimedByOther = claimed.docs.find((d) => d.data().agentId !== agentId)
  if (claimedByOther) {
    const otherSnap = await adminDb
      .doc(`workspaces/${workspaceId}/agents/${claimedByOther.data().agentId}`)
      .get()
    const otherName = (otherSnap.data()?.name as string) ?? 'another agent'
    return c.json(
      { error: `@${bot.username} is already connected to ${otherName}. Disconnect it there first, or use a different bot.` },
      409,
    )
  }

  // One bot per agent: reuse this agent's existing telegram doc if it has one.
  const mine = await channelOfType(workspaceId, agentId, 'telegram')
  const channelRef = mine ? mine.ref : channelsCol(workspaceId).doc()
  const channelId = channelRef.id
  const webhookSecret = randomBytes(24).toString('hex')

  // Write the channel doc FIRST so the webhook has somewhere to land.
  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'telegram',
    agentId,
    botTokenEnc: encryptSecret(botToken),
    webhookSecret,
    telegram: { botUsername: bot.username, botId: bot.id },
    isActive: true,
    createdAt: mine?.data().createdAt ?? new Date(),
  })

  try {
    await setWebhook(botToken, `${apiBase}/telegram/webhook/${channelId}`, webhookSecret)
  } catch {
    // Roll back only a doc we just created; leave a pre-existing one alone.
    if (!mine) await channelRef.delete().catch(() => {})
    return c.json({ error: 'Could not register the Telegram webhook. Check the token and try again.' }, 502)
  }

  return c.json({ channelId, botUsername: bot.username })
})

/** DELETE /agents/:agentId/channels/telegram — disconnect this agent's bot. */
agentChannels.delete('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const mine = await channelOfType(workspaceId, agentId, 'telegram')
  if (!mine) return c.json({ ok: true })

  const enc = mine.data().botTokenEnc as string | undefined
  if (enc) {
    try {
      await deleteWebhook(decryptSecret(enc))
    } catch (err) {
      console.warn('[agent-channels/telegram] deleteWebhook failed:', err)
    }
  }
  await mine.ref.delete()
  return c.json({ ok: true })
})

export default agentChannels
