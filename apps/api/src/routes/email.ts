import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { decryptSecret } from '../lib/crypto'
import { verifySvixSignature } from '../lib/email/svix'
import { getReceivedEmail, sendEmail } from '../lib/email/client'
import {
  parseReceivedEmail,
  conversationIdForEmail,
  visitorIdForEmail,
  replySubject,
} from '../lib/email/parse'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import { rateLimit } from '../lib/rate-limit'
import { recordChannelReliability, safeReliabilityDetail } from '../lib/channels/reliability'

/**
 * Public inbound-email webhook (Resend). The webhook carries only metadata —
 * `email.received` with an `email_id` — so we verify the signature, fetch the
 * full email, thread it into a conversation, run the agent turn, and reply.
 */
const email = new Hono()

const WEBHOOK_RATE_WINDOW_MS = 60_000
const WEBHOOK_LIMIT_PER_IP = 120

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

async function findEmailChannel(channelId: string) {
  const snap = await adminDb.collectionGroup('channels').where('id', '==', channelId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return doc.data().type === 'email' ? doc : null
}

interface WebhookEvent {
  type?: string
  data?: {
    email_id?: string
    message_id?: string
    to?: string[]
  }
}

email.post('/webhook/:channelId', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`email:ip:${ip}`, WEBHOOK_LIMIT_PER_IP, WEBHOOK_RATE_WINDOW_MS).ok) {
    return c.json({ ok: true }) // acknowledge, do no work
  }

  const channelId = c.req.param('channelId')
  try {
    const channelDoc = await findEmailChannel(channelId)
    if (!channelDoc) {
      console.warn('[email/webhook] unknown channel', channelId)
      return c.json({ ok: true })
    }
    const channel = channelDoc.data()
    const workspaceId: string = channel.workspaceId

    // Verify the Svix signature against the raw body before trusting it.
    const raw = await c.req.text()
    const secret = channel.webhookSecret as string | undefined
    if (!secret || !verifySvixSignature(raw, {
      id: c.req.header('svix-id'),
      timestamp: c.req.header('svix-timestamp'),
      signature: c.req.header('svix-signature'),
    }, secret)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    let event: WebhookEvent
    try { event = JSON.parse(raw) as WebhookEvent } catch { return c.json({ ok: true }) }
    if (event.type !== 'email.received' || !event.data?.email_id) {
      return c.json({ ok: true }) // only inbound receipts are handled here
    }

    let apiKey: string
    try { apiKey = decryptSecret(channel.resendApiKeyEnc as string) } catch (err) {
      console.error('[email/webhook] key decrypt failed:', err)
      await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'inbound', outcome: 'failure', stage: 'credential_decrypt', detail: safeReliabilityDetail(err) })
      return c.json({ ok: true })
    }

    const received = await getReceivedEmail(apiKey, event.data.email_id)
    const parsed = parseReceivedEmail(received, event.data.message_id)
    if (!parsed.text) return c.json({ ok: true }) // attachment-only / empty — nothing to answer
    await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'inbound', outcome: 'success', stage: 'webhook_accepted' })

    const conversationId = conversationIdForEmail(parsed.inReplyTo ?? parsed.messageId)
    const visitorId = visitorIdForEmail(parsed.fromAddress)
    const supportAddress = (channel.config?.fromAddress as string | undefined) ?? parsed.toAddress ?? ''

    const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
    const convSnap = await convRef.get()

    const emailFields = {
      emailReplyTo: parsed.fromAddress,
      emailReplyFrom: supportAddress,
      emailSubject: parsed.subject,
      emailMessageId: parsed.messageId,
    }

    // A human owns (or has queued) this thread — record the message and stay silent.
    if (convSnap.exists && convSnap.data()!.status !== 'bot') {
      await convRef.collection('messages').add({ role: 'user', content: parsed.text, createdAt: new Date() })
      await convRef.update({ ...emailFields, updatedAt: new Date(), lastMessage: parsed.text.slice(0, 200), lastMessageRole: 'user', unread: true, lastCustomerMessageAt: new Date() })
      return c.json({ ok: true })
    }

    const prepared = await prepareTurn({
      workspaceId, channelId, conversationId, visitorId, message: parsed.text,
      channelType: 'email', agentId: channel.agentId,
    })

    if (prepared.kind === 'gated' || prepared.kind === 'error' || prepared.kind === 'silent') {
      // No reply is sent — a gated/errored workspace must not bounce its customers.
      return c.json({ ok: true })
    }

    // The conversation now exists (prepareTurn created it); attach email metadata.
    await convRef.update({ ...emailFields, updatedAt: new Date() }).catch(() => {})

    if (prepared.kind === 'workflow') {
      try {
        await sendEmail({
          apiKey, from: supportAddress, to: parsed.fromAddress,
          subject: replySubject(parsed.subject), text: prepared.message, inReplyTo: parsed.messageId,
        })
        await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'success', stage: 'workflow_reply', conversationId })
      } catch (err) {
        console.warn('[email/webhook] handoff send failed:', err)
        await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'failure', stage: 'workflow_reply', detail: safeReliabilityDetail(err), conversationId })
      }
      return c.json({ ok: true })
    }

    const generation = prepared.trace.generation({
      name: 'llm-chat', model: prepared.llmModel,
      input: { system: prepared.chatParams.systemPrompt, messages: prepared.chatParams.messages },
    })

    const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools, prepared.mcpTools, prepared.trustedTools)
    let generated = ''
    let promptTokens = 0
    let completionTokens = 0
    try {
      while (true) {
        const next = await gen.next()
        if (next.done) { promptTokens = next.value.promptTokens; completionTokens = next.value.completionTokens; break }
        generated += next.value.text
      }
      generated = generated.trim()
      generation.end({ output: generated, usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens } })
    } catch (err) {
      console.error('[email/webhook] LLM stream failed:', err)
      generation.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'failure', stage: 'response_generation', detail: safeReliabilityDetail(err), conversationId })
      return c.json({ ok: true })
    }

    let reply = [prepared.prefix, generated].filter(Boolean).join('\n\n')
    if (!reply) reply = 'Sorry, I could not generate a response.'
    await prepared.persist(reply, promptTokens, completionTokens)
    try {
      await sendEmail({
        apiKey, from: supportAddress, to: parsed.fromAddress,
        subject: replySubject(parsed.subject), text: reply, inReplyTo: parsed.messageId,
      })
      await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'success', stage: 'agent_reply', conversationId })
    } catch (err) {
      console.error('[email/webhook] reply send failed:', err)
      await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'failure', stage: 'agent_reply', detail: safeReliabilityDetail(err), conversationId })
    }

    return c.json({ ok: true })
  } catch (err) {
    console.error('[email/webhook] handler error:', err)
    // Always 200 so Resend doesn't retry-storm on a transient infra failure.
    return c.json({ ok: true })
  }
})

export default email
