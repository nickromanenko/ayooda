import { Hono } from 'hono'
import { timingSafeEqual } from 'crypto'
import { adminDb } from '../lib/firebase-admin'
import { decryptSecret } from '../lib/crypto'
import { parseUpdate } from '../lib/telegram/update'
import { sendMessage } from '../lib/telegram/client'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import { rateLimit } from '../lib/rate-limit'

const telegram = new Hono()

const WEBHOOK_RATE_WINDOW_MS = 60_000
const WEBHOOK_LIMIT_PER_IP = 120

/** Constant-time secret comparison; false if either side is missing or lengths differ. */
function secretMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Best-effort client IP from proxy headers. */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

/** Look up a telegram channel doc by its id (collection-group query). */
async function findTelegramChannel(channelId: string) {
  const snap = await adminDb.collectionGroup('channels').where('id', '==', channelId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return doc.data().type === 'telegram' ? doc : null
}

telegram.post('/webhook/:channelId', async (c) => {
  const ip = clientIp(c)
  if (!rateLimit(`tg:ip:${ip}`, WEBHOOK_LIMIT_PER_IP, WEBHOOK_RATE_WINDOW_MS).ok) {
    return c.json({ ok: true }) // acknowledge (don't 429 — avoid Telegram retries) but do no work
  }

  const channelId = c.req.param('channelId')
  try {
    const channelDoc = await findTelegramChannel(channelId)
    if (!channelDoc) {
      console.warn('[telegram/webhook] unknown channel', channelId)
      return c.json({ ok: true }) // acknowledge so Telegram stops retrying
    }
    const channel = channelDoc.data()

    // Auth: Telegram's secret-token header must match the stored secret
    const sig = c.req.header('x-telegram-bot-api-secret-token')
    if (!secretMatches(sig, channel.webhookSecret)) return c.json({ error: 'Unauthorized' }, 401)

    const workspaceId: string = channel.workspaceId
    let token: string
    try {
      token = decryptSecret(channel.botTokenEnc)
    } catch (err) {
      console.error('[telegram/webhook] token decrypt failed:', err)
      return c.json({ ok: true })
    }

    const parsed = parseUpdate(await c.req.json().catch(() => null))
    if (parsed.kind === 'ignore') return c.json({ ok: true })

    const chatId = parsed.chatId
    try {
      if (parsed.kind === 'nontext') {
        await sendMessage(token, chatId, 'I can only read text right now.')
        return c.json({ ok: true })
      }

      const conversationId = `tg_${chatId}`
      const visitorId = `tg_${parsed.userId}`

      // If a human operator has taken over, save the message and stay silent.
      const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
      const convSnap = await convRef.get()
      if (convSnap.exists && convSnap.data()!.status !== 'bot') {
        await convRef.collection('messages').add({
          role: 'user', content: parsed.text, createdAt: new Date(),
        })
        await convRef.update({ updatedAt: new Date(), lastMessage: parsed.text.slice(0, 200) })
        return c.json({ ok: true })
      }

      const prepared = await prepareTurn({
        workspaceId, channelId, conversationId, visitorId, message: parsed.text,
        channelType: 'telegram', telegramChatId: chatId, agentId: channel.agentId,
      })
      if (prepared.kind === 'gated') {
        await sendMessage(token, chatId, 'This assistant is temporarily unavailable.')
        return c.json({ ok: true })
      }
      if (prepared.kind === 'error') {
        console.warn('[telegram/webhook] prepare error:', prepared.error)
        await sendMessage(token, chatId, "The assistant isn't configured yet. Please contact the site owner.")
        return c.json({ ok: true })
      }

      if (prepared.kind === 'silent') {
        return c.json({ ok: true })
      }
      if (prepared.kind === 'escalated') {
        await sendMessage(token, chatId, prepared.message)
        return c.json({ ok: true })
      }

      // Accumulate the full reply (Telegram doesn't stream), then send once.
      const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools)
      let reply = ''
      let promptTokens = 0
      let completionTokens = 0
      const generation = prepared.trace.generation({ name: 'llm-chat', model: prepared.llmModel, input: { system: prepared.chatParams.systemPrompt, messages: prepared.chatParams.messages } })
      try {
        while (true) {
          const next = await gen.next()
          if (next.done) { promptTokens = next.value.promptTokens; completionTokens = next.value.completionTokens; break }
          reply += next.value.text
        }
        reply = reply.trim()
        generation.end({ output: reply, usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens } })
      } catch (err) {
        generation.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
        await sendMessage(token, chatId, 'Sorry, something went wrong. Please try again.')
        return c.json({ ok: true })
      }

      if (reply.length === 0) reply = 'Sorry, I could not generate a response.'
      await prepared.persist(reply, promptTokens, completionTokens)
      await sendMessage(token, chatId, reply)
    } catch (err) {
      console.error('[telegram/webhook] handler error:', err)
      // Best-effort user notice; always 200 so Telegram doesn't retry-storm.
      try { await sendMessage(token, chatId, 'Sorry, something went wrong.') } catch { /* ignore */ }
    }
    return c.json({ ok: true })
  } catch (err) {
    console.error('[telegram/webhook] outer handler error:', err)
    // Always 200 so a transient infra failure (e.g. Firestore DEADLINE_EXCEEDED)
    // doesn't trigger a Telegram retry storm.
    return c.json({ ok: true })
  }
})

export default telegram
