import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { decryptSecret } from '../lib/crypto'
import { rateLimit } from '../lib/rate-limit'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import { sendSlackMessage } from '../lib/slack/client'
import { parseSlackEnvelope, slackConversationId, slackVisitorId, type ParsedSlackEnvelope } from '../lib/slack/events'
import { verifySlackSignature } from '../lib/slack/signature'
import { recordChannelReliability, safeReliabilityDetail } from '../lib/channels/reliability'

const slack = new Hono()
const WEBHOOK_RATE_WINDOW_MS = 60_000
const WEBHOOK_LIMIT_PER_IP = 180
const EVENT_RECEIPT_TTL_MS = 24 * 60 * 60_000

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

async function findSlackChannel(channelId: string) {
  const snap = await adminDb.collectionGroup('channels').where('id', '==', channelId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return doc.data().type === 'slack' ? doc : null
}

async function claimSlackEvent(workspaceId: string, eventId: string): Promise<boolean> {
  try {
    await adminDb.doc(`workspaces/${workspaceId}/slackEventReceipts/${eventId}`).create({
      expiresAt: new Date(Date.now() + EVENT_RECEIPT_TTL_MS),
      createdAt: new Date(),
    })
    return true
  } catch (error) {
    const code = (error as { code?: number | string }).code
    if (code === 6 || code === 'already-exists') return false
    throw error
  }
}

async function processSlackMessage(
  channelId: string,
  channel: FirebaseFirestore.DocumentData,
  parsed: Extract<ParsedSlackEnvelope, { kind: 'message' }>,
): Promise<void> {
  const workspaceId = String(channel.workspaceId)
  if (!(await claimSlackEvent(workspaceId, parsed.eventId))) return

  let botToken: string
  try { botToken = decryptSecret(String(channel.slackBotTokenEnc)) } catch (error) {
    console.error('[slack/events] bot token decrypt failed:', error)
    return
  }

  const conversationId = slackConversationId(parsed.teamId, parsed.channelId, parsed.threadTs, parsed.direct)
  const visitorId = slackVisitorId(parsed.teamId, parsed.userId)
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  const slackFields = {
    slackTeamId: parsed.teamId,
    slackChannelId: parsed.channelId,
    slackThreadTs: parsed.threadTs ?? null,
    slackUserId: parsed.userId,
  }

  if (convSnap.exists && convSnap.data()!.status !== 'bot') {
    await convRef.collection('messages').add({ role: 'user', content: parsed.text, createdAt: new Date() })
    await convRef.update({ ...slackFields, updatedAt: new Date(), lastMessage: parsed.text.slice(0, 200), lastMessageRole: 'user', unread: true, lastCustomerMessageAt: new Date() })
    return
  }

  const prepared = await prepareTurn({
    workspaceId,
    channelId,
    conversationId,
    visitorId,
    message: parsed.text,
    channelType: 'slack',
    agentId: channel.agentId,
  })

  if (prepared.kind === 'gated') {
    await sendSlackMessage(botToken, parsed.channelId, 'This assistant is temporarily unavailable.', parsed.threadTs)
    return
  }
  if (prepared.kind === 'error') {
    console.warn('[slack/events] prepare error:', prepared.error)
    await sendSlackMessage(botToken, parsed.channelId, "The assistant isn't configured yet. Please contact the workspace owner.", parsed.threadTs)
    return
  }
  if (prepared.kind === 'silent') return

  await convRef.update({ ...slackFields, updatedAt: new Date() }).catch(() => {})
  if (prepared.kind === 'workflow') {
    await sendSlackMessage(botToken, parsed.channelId, prepared.message, parsed.threadTs)
    return
  }

  const generation = prepared.trace.generation({
    name: 'llm-chat',
    model: prepared.llmModel,
    input: { system: prepared.chatParams.systemPrompt, messages: prepared.chatParams.messages },
  })
  const stream = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools, prepared.mcpTools)
  let generated = ''
  let promptTokens = 0
  let completionTokens = 0
  try {
    while (true) {
      const next = await stream.next()
      if (next.done) {
        promptTokens = next.value.promptTokens
        completionTokens = next.value.completionTokens
        break
      }
      generated += next.value.text
    }
    generated = generated.trim()
    generation.end({ output: generated, usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens } })
  } catch (error) {
    generation.end({ level: 'ERROR', statusMessage: error instanceof Error ? error.message : String(error) })
    await sendSlackMessage(botToken, parsed.channelId, 'Sorry, something went wrong. Please try again.', parsed.threadTs)
    return
  }

  const reply = [prepared.prefix, generated].filter(Boolean).join('\n\n') || 'Sorry, I could not generate a response.'
  await prepared.persist(reply, promptTokens, completionTokens)
  await sendSlackMessage(botToken, parsed.channelId, reply, parsed.threadTs)
}

/** Public Slack Events API endpoint. Event receipts make Slack retries duplicate-safe. */
slack.post('/events/:channelId', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`slack:ip:${ip}`, WEBHOOK_LIMIT_PER_IP, WEBHOOK_RATE_WINDOW_MS).ok) return c.json({ ok: true })

  const channelId = c.req.param('channelId')
  const channelDoc = await findSlackChannel(channelId).catch((error) => {
    console.error('[slack/events] channel lookup failed:', error)
    return null
  })
  if (!channelDoc) return c.json({ ok: true })
  const channel = channelDoc.data()

  const declaredLength = Number(c.req.header('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 256 * 1024) return c.json({ ok: true })
  const raw = await c.req.text()
  if (raw.length > 256 * 1024) return c.json({ ok: true })
  let signingSecret: string
  try { signingSecret = decryptSecret(String(channel.slackSigningSecretEnc)) } catch (error) {
    console.error('[slack/events] signing secret decrypt failed:', error)
    return c.json({ ok: true })
  }
  if (!verifySlackSignature(raw, {
    timestamp: c.req.header('x-slack-request-timestamp'),
    signature: c.req.header('x-slack-signature'),
  }, signingSecret)) return c.json({ error: 'Unauthorized' }, 401)

  let body: unknown
  try { body = JSON.parse(raw) as unknown } catch { return c.json({ ok: true }) }
  const parsed = parseSlackEnvelope(body, String(channel.slack?.botUserId ?? ''))
  if (parsed.kind === 'challenge') return c.json({ challenge: parsed.challenge })
  if (parsed.kind === 'ignore' || parsed.teamId !== channel.slack?.teamId) return c.json({ ok: true })

  try {
    await processSlackMessage(channelId, channel, parsed)
    await recordChannelReliability({
      workspaceId: String(channel.workspaceId), channelId, channelType: 'slack',
      direction: 'inbound', outcome: 'success', stage: 'message_processed',
    })
  } catch (error) {
    console.error('[slack/events] handler failed:', error)
    await recordChannelReliability({
      workspaceId: String(channel.workspaceId), channelId, channelType: 'slack',
      direction: 'inbound', outcome: 'failure', stage: 'message_processing', detail: safeReliabilityDetail(error),
    })
  }
  return c.json({ ok: true })
})

export default slack
