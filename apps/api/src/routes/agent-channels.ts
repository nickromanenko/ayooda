import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { encryptSecret, decryptSecret } from '../lib/crypto'
import { getMe, setWebhook, deleteWebhook } from '../lib/telegram/client'
import { assertValidApiKey } from '../lib/email/client'
import { authTest as testSlackBotToken } from '../lib/slack/client'
import { assertTwilioNumber } from '../lib/sms/client'
import { isTwilioAccountSid, normalizePhoneNumber } from '../lib/sms/message'
import { validateWidgetAppearance } from '../lib/channels/validate'
import { DEFAULT_WIDGET_APPEARANCE, isEmailAddress } from '@ayooda/shared'
import { canHideBranding } from '../lib/channels/branding'
import { stripChannelSecrets } from '../lib/channels/sanitize'

/**
 * Channels belong to the agent that answers on them. Each agent gets its own
 * web widget (its own embed snippet) and can connect its own Telegram bot, so
 * a workspace with three agents can deploy all three independently.
 */
const agentChannels = new Hono<{ Variables: AuthVariables }>()

agentChannels.use('*', requireAuth)
agentChannels.use('*', requireAgent)

// Falls back to the site the widget is actually hosted on (hosting target
// "widget"), not the app's own site — a missed env var used to bake a 404 into
// every embed snippet it generated.
const WIDGET_BASE_URL = process.env.WIDGET_BASE_URL ?? 'https://cdn.ayooda.live'

const channelsCol = (workspaceId: string) =>
  adminDb.collection(`workspaces/${workspaceId}/channels`)

/** This agent's channel of a given type, or null. */
async function channelOfType(workspaceId: string, agentId: string, type: 'web_widget' | 'telegram' | 'email' | 'slack' | 'sms') {
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
      const safe = stripChannelSecrets(d.data() as Record<string, unknown>)
      const config = (safe.config ?? {}) as Record<string, unknown>
      // Same rule as the workspace-wide list: the agent's identity is read live,
      // never from the channel's cached copy, so a rename shows up immediately.
      return {
        id: d.id,
        ...safe,
        lastSeenAt: (safe.lastSeenAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null,
        ...((safe.type === 'slack' || safe.type === 'sms') && process.env.API_PUBLIC_URL
          ? { webhookUrl: `${process.env.API_PUBLIC_URL.replace(/\/$/, '')}/${safe.type === 'slack' ? 'slack/events' : 'sms/webhook'}/${d.id}` }
          : {}),
        // Same shape as the skills catalogue: the row carries whether the plan
        // permits the option, so the UI can show it locked rather than hide it.
        brandingLocked: !canHide,
        config: {
          ...DEFAULT_WIDGET_APPEARANCE,
          ...config,
          enabled: safe.isActive !== false,
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
    // A previous onboarding attempt may have created the widget before the
    // workspace completion flag was persisted. Keep this idempotent path able
    // to repair that state so the user is not redirected back into onboarding.
    await adminDb.doc(`workspaces/${workspaceId}`).update({ onboardingComplete: true })
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
      ...DEFAULT_WIDGET_APPEARANCE,
      welcomeMessage: `Hi there! How can ${agentName} help you today?`,
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

  const currentConfig = existing.data().config ?? {}
  await existing.ref.update({
    config: {
      ...currentConfig,
      ...result.value,
    },
    isActive: result.value.enabled,
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

/** POST /agents/:agentId/channels/email — connect an inbound-email mailbox to this agent. */
agentChannels.post('/email', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const body = await c.req.json<{ resendApiKey?: string; fromAddress?: string; inboxAddress?: string; webhookSecret?: string }>().catch(() => ({} as { resendApiKey?: string; fromAddress?: string; inboxAddress?: string; webhookSecret?: string }))
  const resendApiKey = body.resendApiKey?.trim()
  const fromAddress = body.fromAddress?.trim().toLowerCase()
  const inboxAddress = body.inboxAddress?.trim().toLowerCase()
  const webhookSecret = body.webhookSecret?.trim()

  if (!resendApiKey) return c.json({ error: 'resendApiKey is required' }, 400)
  if (!fromAddress || !isEmailAddress(fromAddress)) return c.json({ error: 'A valid from address is required.' }, 400)
  if (!inboxAddress || !isEmailAddress(inboxAddress)) return c.json({ error: 'A valid inbox address is required.' }, 400)
  if (!webhookSecret) return c.json({ error: 'webhookSecret is required (copy the Resend webhook signing secret).' }, 400)

  try {
    await assertValidApiKey(resendApiKey)
  } catch {
    return c.json({ error: 'That Resend API key could not be verified.' }, 400)
  }

  const apiBase = process.env.API_PUBLIC_URL
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  // One mailbox per agent: reuse this agent's existing email doc if it has one.
  const mine = await channelOfType(workspaceId, agentId, 'email')
  const channelRef = mine ? mine.ref : channelsCol(workspaceId).doc()
  const channelId = channelRef.id

  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'email',
    agentId,
    resendApiKeyEnc: encryptSecret(resendApiKey),
    webhookSecret,
    config: { fromAddress, inboxAddress },
    isActive: true,
    createdAt: mine?.data().createdAt ?? new Date(),
  })

  return c.json({ channelId, webhookUrl: `${apiBase}/email/webhook/${channelId}`, fromAddress })
})

/** DELETE /agents/:agentId/channels/email — disconnect this agent's mailbox. */
agentChannels.delete('/email', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!

  const mine = await channelOfType(workspaceId, agentId, 'email')
  if (mine) await mine.ref.delete()
  return c.json({ ok: true })
})

/** POST /agents/:agentId/channels/slack — connect an installed Slack bot to this agent. */
agentChannels.post('/slack', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const body = await c.req.json<{ botToken?: string; signingSecret?: string }>().catch(() => ({} as { botToken?: string; signingSecret?: string }))
  const botToken = body.botToken?.trim()
  const signingSecret = body.signingSecret?.trim()
  if (!botToken?.startsWith('xoxb-') || botToken.length > 4_096) return c.json({ error: 'A valid Slack Bot User OAuth Token (xoxb-…) is required.' }, 400)
  if (!signingSecret || signingSecret.length < 16 || signingSecret.length > 512) {
    return c.json({ error: 'A valid Slack signing secret is required.' }, 400)
  }
  const apiBase = process.env.API_PUBLIC_URL
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  let identity
  try { identity = await testSlackBotToken(botToken) } catch {
    return c.json({ error: 'That Slack bot token could not be verified.' }, 400)
  }

  const mine = await channelOfType(workspaceId, agentId, 'slack')
  // A Slack app has one Events API request URL, so the same installed bot cannot
  // safely point at two agents — even if those agents live in different workspaces.
  const claimed = await adminDb.collectionGroup('channels')
    .where('slack.teamId', '==', identity.teamId)
    .where('slack.botUserId', '==', identity.botUserId)
    .limit(2)
    .get()
  const claimedByOther = claimed.docs.find((doc) => doc.ref.path !== mine?.ref.path)
  if (claimedByOther) {
    const claimedWorkspaceId = claimedByOther.ref.parent.parent?.id
    if (claimedWorkspaceId === workspaceId) {
      const other = await adminDb.doc(`workspaces/${workspaceId}/agents/${claimedByOther.data().agentId}`).get()
      return c.json({ error: `This Slack app is already connected to ${(other.data()?.name as string | undefined) ?? 'another agent'}.` }, 409)
    }
    return c.json({ error: 'This Slack app is already connected to another Ayooda agent.' }, 409)
  }

  const channelRef = mine ? mine.ref : channelsCol(workspaceId).doc()
  const channelId = channelRef.id
  const slackIdentity = { teamId: identity.teamId, teamName: identity.teamName, botUserId: identity.botUserId }
  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'slack',
    agentId,
    slackBotTokenEnc: encryptSecret(botToken),
    slackSigningSecretEnc: encryptSecret(signingSecret),
    slack: slackIdentity,
    config: slackIdentity,
    isActive: true,
    createdAt: mine?.data().createdAt ?? new Date(),
  })

  return c.json({
    channelId,
    teamName: identity.teamName,
    botUserId: identity.botUserId,
    webhookUrl: `${apiBase}/slack/events/${channelId}`,
  })
})

/** DELETE /agents/:agentId/channels/slack — disconnect this agent's Slack app. */
agentChannels.delete('/slack', async (c) => {
  const mine = await channelOfType(c.get('workspaceId'), c.get('agentId')!, 'slack')
  if (mine) await mine.ref.delete()
  return c.json({ ok: true })
})

/** POST /agents/:agentId/channels/sms — connect a Twilio phone number to this agent. */
agentChannels.post('/sms', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const body = await c.req.json<{ accountSid?: string; authToken?: string; fromNumber?: string }>()
    .catch(() => ({} as { accountSid?: string; authToken?: string; fromNumber?: string }))
  const accountSid = body.accountSid?.trim() ?? ''
  const authToken = body.authToken?.trim() ?? ''
  const fromNumber = normalizePhoneNumber(body.fromNumber?.trim() ?? '')

  if (!isTwilioAccountSid(accountSid)) return c.json({ error: 'A valid Twilio Account SID (AC…) is required.' }, 400)
  if (authToken.length < 16 || authToken.length > 512) return c.json({ error: 'A valid Twilio Auth Token is required.' }, 400)
  if (!fromNumber) return c.json({ error: 'Enter the Twilio SMS number in E.164 format, such as +14155552671.' }, 400)
  const apiBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  try {
    await assertTwilioNumber(accountSid, authToken, fromNumber)
  } catch (error) {
    console.warn('[agent-channels/sms] Twilio verification failed:', error)
    return c.json({ error: 'Those Twilio credentials or phone number could not be verified.' }, 400)
  }

  const mine = await channelOfType(workspaceId, agentId, 'sms')
  // A Twilio number has one inbound messaging webhook, so it cannot safely serve
  // two agents. Check globally, including other Ayooda workspaces.
  const claimed = await adminDb.collectionGroup('channels')
    .where('twilio.accountSid', '==', accountSid)
    .where('twilio.fromNumber', '==', fromNumber)
    .limit(2)
    .get()
  const claimedByOther = claimed.docs.find((doc) => doc.ref.path !== mine?.ref.path)
  if (claimedByOther) {
    const claimedWorkspaceId = claimedByOther.ref.parent.parent?.id
    if (claimedWorkspaceId === workspaceId) {
      const other = await adminDb.doc(`workspaces/${workspaceId}/agents/${claimedByOther.data().agentId}`).get()
      return c.json({ error: `This Twilio number is already connected to ${(other.data()?.name as string | undefined) ?? 'another agent'}.` }, 409)
    }
    return c.json({ error: 'This Twilio number is already connected to another Ayooda agent.' }, 409)
  }

  const channelRef = mine ? mine.ref : channelsCol(workspaceId).doc()
  const channelId = channelRef.id
  const twilio = { accountSid, fromNumber }
  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'sms',
    agentId,
    twilioAuthTokenEnc: encryptSecret(authToken),
    twilio,
    config: twilio,
    isActive: true,
    createdAt: mine?.data().createdAt ?? new Date(),
  })

  return c.json({ channelId, fromNumber, webhookUrl: `${apiBase}/sms/webhook/${channelId}` })
})

/** DELETE /agents/:agentId/channels/sms — disconnect this agent's Twilio number. */
agentChannels.delete('/sms', async (c) => {
  const mine = await channelOfType(c.get('workspaceId'), c.get('agentId')!, 'sms')
  if (mine) await mine.ref.delete()
  return c.json({ ok: true })
})

export default agentChannels
