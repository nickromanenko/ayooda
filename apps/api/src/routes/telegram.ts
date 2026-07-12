import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { decryptSecret } from '../lib/crypto'
import { parseUpdate } from '../lib/telegram/update'
import { sendMessage } from '../lib/telegram/client'
import { prepareTurn } from '../lib/chat/agent-turn'
import { streamChat } from '../lib/llm/openrouter'

const telegram = new Hono()

/** Look up a telegram channel doc by its id (collection-group query). */
async function findTelegramChannel(channelId: string) {
  const snap = await adminDb.collectionGroup('channels').where('id', '==', channelId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return doc.data().type === 'telegram' ? doc : null
}

telegram.post('/webhook/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const channelDoc = await findTelegramChannel(channelId)
  if (!channelDoc) {
    console.warn('[telegram/webhook] unknown channel', channelId)
    return c.json({ ok: true }) // acknowledge so Telegram stops retrying
  }
  const channel = channelDoc.data()

  // Auth: Telegram's secret-token header must match the stored secret
  const sig = c.req.header('x-telegram-bot-api-secret-token')
  if (sig !== channel.webhookSecret) return c.json({ error: 'Unauthorized' }, 401)

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
    if (convSnap.exists && convSnap.data()!.status === 'human') {
      await convRef.collection('messages').add({
        role: 'user', content: parsed.text, createdAt: new Date(),
      })
      await convRef.update({ updatedAt: new Date(), lastMessage: parsed.text.slice(0, 200) })
      return c.json({ ok: true })
    }

    const prepared = await prepareTurn({
      workspaceId, channelId, conversationId, visitorId, message: parsed.text,
      channelType: 'telegram', telegramChatId: chatId,
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

    // Accumulate the full reply (Telegram doesn't stream), then send once.
    const gen = streamChat(prepared.chatParams)
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
})

export default telegram
