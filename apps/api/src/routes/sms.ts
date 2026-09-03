import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { decryptSecret } from '../lib/crypto'
import { rateLimit } from '../lib/rate-limit'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import { sendSms } from '../lib/sms/client'
import { formParams, verifyTwilioSignature } from '../lib/sms/signature'
import { parseInboundSms, smsConversationId, smsVisitorId } from '../lib/sms/message'
import { recordChannelReliability, safeReliabilityDetail } from '../lib/channels/reliability'

const sms = new Hono()
const WEBHOOK_RATE_WINDOW_MS = 60_000
const WEBHOOK_LIMIT_PER_IP = 180
const MESSAGE_RECEIPT_TTL_MS = 24 * 60 * 60_000
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function twiml(c: { body: (body: string, status?: 200) => Response }): Response {
  return c.body(EMPTY_TWIML, 200)
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

async function findSmsChannel(channelId: string) {
  const snap = await adminDb.collectionGroup('channels').where('id', '==', channelId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return doc.data().type === 'sms' && doc.data().isActive !== false ? doc : null
}

async function claimSmsMessage(workspaceId: string, messageSid: string): Promise<boolean> {
  try {
    await adminDb.doc(`workspaces/${workspaceId}/smsMessageReceipts/${messageSid}`).create({
      expiresAt: new Date(Date.now() + MESSAGE_RECEIPT_TTL_MS),
      createdAt: new Date(),
    })
    return true
  } catch (error) {
    const code = (error as { code?: number | string }).code
    if (code === 6 || code === 'already-exists') return false
    throw error
  }
}

async function processSms(
  channelId: string,
  channel: FirebaseFirestore.DocumentData,
  inbound: NonNullable<ReturnType<typeof parseInboundSms>>,
): Promise<void> {
  const workspaceId = String(channel.workspaceId)
  if (!(await claimSmsMessage(workspaceId, inbound.messageSid))) return

  let authToken: string
  try { authToken = decryptSecret(String(channel.twilioAuthTokenEnc)) } catch (error) {
    console.error('[sms/webhook] auth token decrypt failed:', error)
    return
  }

  const accountSid = String(channel.twilio?.accountSid ?? '')
  const conversationId = smsConversationId(inbound.from, inbound.to)
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  const smsFields = { smsFrom: inbound.from, smsTo: inbound.to, smsMessageSid: inbound.messageSid }

  if (convSnap.exists && convSnap.data()!.status !== 'bot') {
    await convRef.collection('messages').add({ role: 'user', content: inbound.body, createdAt: new Date() })
    await convRef.update({ ...smsFields, updatedAt: new Date(), lastMessage: inbound.body.slice(0, 200), lastMessageRole: 'user', unread: true, lastCustomerMessageAt: new Date() })
    return
  }

  const prepared = await prepareTurn({
    workspaceId,
    channelId,
    conversationId,
    visitorId: smsVisitorId(inbound.from),
    message: inbound.body,
    channelType: 'sms',
    agentId: channel.agentId,
  })

  if (prepared.kind === 'gated') {
    await sendSms(accountSid, authToken, inbound.to, inbound.from, 'This assistant is temporarily unavailable.')
    return
  }
  if (prepared.kind === 'error') {
    console.warn('[sms/webhook] prepare error:', prepared.error)
    await sendSms(accountSid, authToken, inbound.to, inbound.from, "The assistant isn't configured yet. Please contact the workspace owner.")
    return
  }
  if (prepared.kind === 'silent') return

  await convRef.update({ ...smsFields, updatedAt: new Date() }).catch(() => {})
  if (prepared.kind === 'workflow') {
    await sendSms(accountSid, authToken, inbound.to, inbound.from, prepared.message)
    return
  }

  const generation = prepared.trace.generation({
    name: 'llm-chat',
    model: prepared.llmModel,
    input: { system: prepared.chatParams.systemPrompt, messages: prepared.chatParams.messages },
  })
  const stream = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools, prepared.mcpTools, prepared.trustedTools)
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
    await sendSms(accountSid, authToken, inbound.to, inbound.from, 'Sorry, something went wrong. Please try again.')
    return
  }

  const reply = [prepared.prefix, generated].filter(Boolean).join('\n\n') || 'Sorry, I could not generate a response.'
  await prepared.persist(reply, promptTokens, completionTokens)
  await sendSms(accountSid, authToken, inbound.to, inbound.from, reply)
}

/** Public Twilio inbound-message endpoint. Message SID receipts make retries duplicate-safe. */
sms.post('/webhook/:channelId', async (c) => {
  c.header('Content-Type', 'text/xml; charset=utf-8')
  const ip = clientIp(c)
  if (!rateLimit(`sms:ip:${ip}`, WEBHOOK_LIMIT_PER_IP, WEBHOOK_RATE_WINDOW_MS).ok) return twiml(c)

  const channelId = c.req.param('channelId')
  const channelDoc = await findSmsChannel(channelId).catch((error) => {
    console.error('[sms/webhook] channel lookup failed:', error)
    return null
  })
  if (!channelDoc) return twiml(c)
  const channel = channelDoc.data()

  const declaredLength = Number(c.req.header('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) return twiml(c)
  const raw = await c.req.text()
  if (raw.length > 64 * 1024) return twiml(c)
  const params = formParams(raw)

  let authToken: string
  try { authToken = decryptSecret(String(channel.twilioAuthTokenEnc)) } catch (error) {
    console.error('[sms/webhook] auth token decrypt failed:', error)
    return twiml(c)
  }
  const apiBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
  const publicUrl = apiBase ? `${apiBase}/sms/webhook/${channelId}` : ''
  if (!verifyTwilioSignature(authToken, c.req.header('x-twilio-signature'), publicUrl, params)) {
    return c.text('Unauthorized', 401)
  }

  const inbound = parseInboundSms(params)
  if (!inbound || inbound.to !== channel.twilio?.fromNumber) return twiml(c)
  try {
    await processSms(channelId, channel, inbound)
    await recordChannelReliability({
      workspaceId: String(channel.workspaceId), channelId, channelType: 'sms',
      direction: 'inbound', outcome: 'success', stage: 'message_processed',
    })
  } catch (error) {
    console.error('[sms/webhook] handler failed:', error)
    await recordChannelReliability({
      workspaceId: String(channel.workspaceId), channelId, channelType: 'sms',
      direction: 'inbound', outcome: 'failure', stage: 'message_processing', detail: safeReliabilityDetail(error),
    })
  }
  return twiml(c)
})

export default sms
