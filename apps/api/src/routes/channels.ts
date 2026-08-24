import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { stripChannelSecrets } from '../lib/channels/sanitize'
import { decryptSecret } from '../lib/crypto'
import { getMe } from '../lib/telegram/client'
import { assertValidApiKey } from '../lib/email/client'
import { authTest } from '../lib/slack/client'
import { assertTwilioNumber } from '../lib/sms/client'
import { recordChannelReliability, reliabilityStatus, safeReliabilityDetail } from '../lib/channels/reliability'
import { invalidateChannelAlertSettings, loadChannelAlertSettings, validateChannelAlertSettings } from '../lib/channels/alerts'

const channels = new Hono<{ Variables: AuthVariables }>()

channels.use('*', requireAuth)
channels.use('*', requireOwner)

/**
 * GET /channels — every channel in the workspace, newest first.
 *
 * Creating and removing channels lives under the agent that owns them
 * (/agents/:agentId/channels); this workspace-wide list exists only so the
 * Overview can show where each agent is live.
 *
 * The agent's name and photo are resolved live from the agent doc rather than
 * from the channel's cached `config` copy — renaming an agent must not leave
 * the dashboard showing a stale name. The cache remains the fallback for a
 * channel whose agent has since been deleted.
 */
channels.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')

  const [snap, agentsSnap] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/channels`).orderBy('createdAt', 'desc').get(),
    adminDb.collection(`workspaces/${workspaceId}/agents`).get(),
  ])

  const agents = new Map(agentsSnap.docs.map((d) => [d.id, d.data()]))

  return c.json(snap.docs.map((d) => {
    const safe = stripChannelSecrets(d.data() as Record<string, unknown>)
    const config = (safe.config ?? {}) as Record<string, unknown>
    const agent = typeof safe.agentId === 'string' ? agents.get(safe.agentId) : undefined
    return {
      id: d.id,
      ...safe,
      config: {
        ...config,
        agentName: agent?.name ?? config.agentName ?? 'Support Agent',
        agentPhotoURL: agent?.photoURL ?? config.agentPhotoURL ?? null,
      },
    }
  }))
})

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }
  return null
}

async function alertTransports(workspaceId: string) {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/channels`).get()
  const email = snap.docs.filter((doc) => doc.data().type === 'email' && doc.data().isActive !== false).map((doc) => ({
    id: doc.id,
    label: String(doc.data().config?.fromAddress ?? doc.data().config?.inboxAddress ?? 'Email channel'),
  }))
  const slack = snap.docs.filter((doc) => doc.data().type === 'slack' && doc.data().isActive !== false).map((doc) => ({
    id: doc.id,
    label: String(doc.data().slack?.teamName ?? doc.data().config?.teamName ?? 'Slack app'),
  }))
  return { email, slack }
}

/** GET /channels/reliability — workspace-wide health summaries and recent events. */
channels.get('/reliability', async (c) => {
  const workspaceId = c.get('workspaceId')
  const [channelsSnap, agentsSnap, statesSnap] = await Promise.all([
    adminDb.collection(`workspaces/${workspaceId}/channels`).orderBy('createdAt', 'desc').get(),
    adminDb.collection(`workspaces/${workspaceId}/agents`).get(),
    adminDb.collection(`workspaces/${workspaceId}/channelReliability`).get(),
  ])
  const agents = new Map(agentsSnap.docs.map((doc) => [doc.id, doc.data()]))
  const states = new Map(statesSnap.docs.map((doc) => [doc.id, doc.data()]))

  const rows = await Promise.all(channelsSnap.docs.map(async (doc) => {
    const channel = doc.data()
    const state = states.get(doc.id) ?? {}
    const eventsCol = adminDb.collection(`workspaces/${workspaceId}/channelReliability/${doc.id}/events`)
    const eventsSnap = await eventsCol
      .orderBy('occurredAt', 'desc')
      .limit(20)
      .get()
    const agent = typeof channel.agentId === 'string' ? agents.get(channel.agentId) : undefined
    return {
      id: doc.id,
      type: String(channel.type ?? 'unknown'),
      isActive: channel.isActive !== false,
      agentId: channel.agentId ?? null,
      agentName: agent?.name ?? channel.config?.agentName ?? 'Support Agent',
      status: reliabilityStatus({
        isActive: channel.isActive !== false,
        lastSuccessAt: state.lastSuccessAt,
        lastFailureAt: state.lastFailureAt,
        consecutiveFailures: state.consecutiveFailures,
      }),
      successCount: Number(state.successCount ?? 0),
      failureCount: Number(state.failureCount ?? 0),
      consecutiveFailures: Number(state.consecutiveFailures ?? 0),
      lastEventAt: iso(state.lastEventAt),
      lastInboundAt: iso(state.lastInboundAt),
      lastOutboundAt: iso(state.lastOutboundAt),
      lastSuccessAt: iso(state.lastSuccessAt),
      lastFailureAt: iso(state.lastFailureAt),
      lastStage: state.lastStage ?? null,
      lastDetail: state.lastDetail ?? null,
      alertIncidentOpen: state.alertIncidentOpen === true,
      lastAlertKind: state.lastAlertKind ?? null,
      lastAlertAt: iso(state.lastAlertAt),
      lastAlertDeliveryAt: iso(state.lastAlertDeliveryAt),
      lastAlertDeliveryStatus: state.lastAlertDeliveryStatus ?? null,
      lastAlertDeliveryDetail: state.lastAlertDeliveryDetail ?? null,
      events: eventsSnap.docs.filter((eventDoc) => {
        const expiresAt = eventDoc.data().expiresAt
        const expiry = expiresAt?.toDate?.() ?? null
        return !expiry || expiry.getTime() > Date.now()
      }).slice(0, 8).map((eventDoc) => {
        const event = eventDoc.data()
        return {
          id: eventDoc.id,
          direction: event.direction,
          outcome: event.outcome,
          stage: event.stage,
          detail: event.detail ?? null,
          occurredAt: iso(event.occurredAt),
        }
      }),
    }
  }))

  return c.json({
    summary: {
      total: rows.length,
      healthy: rows.filter((row) => row.status === 'healthy').length,
      failing: rows.filter((row) => row.status === 'failing').length,
      unchecked: rows.filter((row) => row.status === 'unchecked').length,
    },
    channels: rows,
  })
})

/** GET /channels/reliability/alerts — alert policy plus usable delivery transports. */
channels.get('/reliability/alerts', async (c) => {
  const workspaceId = c.get('workspaceId')
  const [settings, transports, userSnap] = await Promise.all([
    loadChannelAlertSettings(workspaceId),
    alertTransports(workspaceId),
    adminDb.doc(`users/${c.get('uid')}`).get(),
  ])
  return c.json({
    settings: {
      ...settings,
      email: {
        ...settings.email,
        address: settings.email.address || String(userSnap.data()?.email ?? ''),
        transportChannelId: settings.email.transportChannelId || transports.email[0]?.id || '',
      },
      slack: {
        ...settings.slack,
        transportChannelId: settings.slack.transportChannelId || transports.slack[0]?.id || '',
      },
    },
    transports,
  })
})

/** PUT /channels/reliability/alerts — replace the owner-managed alert policy. */
channels.put('/reliability/alerts', async (c) => {
  const workspaceId = c.get('workspaceId')
  const result = validateChannelAlertSettings(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)

  const transports = await alertTransports(workspaceId)
  if (result.value.email.enabled && !transports.email.some((channel) => channel.id === result.value.email.transportChannelId)) {
    return c.json({ error: 'The selected email channel is unavailable.' }, 400)
  }
  if (result.value.slack.enabled && !transports.slack.some((channel) => channel.id === result.value.slack.transportChannelId)) {
    return c.json({ error: 'The selected Slack app is unavailable.' }, 400)
  }

  await adminDb.doc(`workspaces/${workspaceId}/channelAlertSettings/default`).set({
    ...result.value,
    updatedAt: new Date(),
    updatedBy: c.get('uid'),
  })
  invalidateChannelAlertSettings(workspaceId)
  return c.json({ settings: result.value })
})

/** POST /channels/:channelId/diagnose — live credential/provider connectivity check. */
channels.post('/:channelId/diagnose', async (c) => {
  const workspaceId = c.get('workspaceId')
  const channelId = c.req.param('channelId')
  const channelSnap = await adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`).get()
  if (!channelSnap.exists) return c.json({ error: 'Channel not found' }, 404)
  const channel = channelSnap.data()!
  const type = String(channel.type ?? 'unknown')

  try {
    if (channel.isActive === false) throw new Error('This channel is inactive.')
    if (type === 'web_widget') {
      if (!channel.embedCode) throw new Error('The widget embed code is missing.')
      const agentSnap = await adminDb.doc(`workspaces/${workspaceId}/agents/${channel.agentId}`).get()
      if (!agentSnap.exists) throw new Error('The assigned agent no longer exists.')
    } else if (type === 'telegram') {
      await getMe(decryptSecret(String(channel.botTokenEnc)))
    } else if (type === 'email') {
      await assertValidApiKey(decryptSecret(String(channel.resendApiKeyEnc)))
    } else if (type === 'slack') {
      await authTest(decryptSecret(String(channel.slackBotTokenEnc)))
    } else if (type === 'sms') {
      await assertTwilioNumber(
        String(channel.twilio?.accountSid ?? ''),
        decryptSecret(String(channel.twilioAuthTokenEnc)),
        String(channel.twilio?.fromNumber ?? ''),
      )
    } else {
      throw new Error(`Diagnostics are not supported for ${type}.`)
    }

    await recordChannelReliability({
      workspaceId, channelId, channelType: type,
      direction: 'diagnostic', outcome: 'success', stage: 'connection_check',
      detail: 'Provider credentials and channel configuration are valid.',
    })
    return c.json({ ok: true })
  } catch (error) {
    const detail = safeReliabilityDetail(error)
    await recordChannelReliability({
      workspaceId, channelId, channelType: type,
      direction: 'diagnostic', outcome: 'failure', stage: 'connection_check', detail,
    })
    return c.json({ ok: false, error: detail })
  }
})

export default channels
