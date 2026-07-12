/**
 * Public widget routes — no auth required.
 * These are called directly from embedded scripts on customer websites.
 *
 * GET  /widget/config/:channelId   — widget appearance + agent info
 * POST /widget/chat                — RAG chat: embed → retrieve → generate → save
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { FieldValue } from 'firebase-admin/firestore'
import { providerOf } from '@ayooda/shared'
import { checkEntitlement, shouldResetPeriod } from '../lib/billing/entitlement'
import { adminDb } from '../lib/firebase-admin'
import { embedText, LEGACY_MODEL_MAP } from '../lib/gemini'
import { getLangfuse } from '../lib/langfuse'
import { streamChat } from '../lib/llm/openrouter'
import { resolveOpenRouterKey } from '../lib/llm/resolve'
import { namespaceFor } from '../lib/pinecone'
import { rateLimit } from '../lib/rate-limit'

const widget = new Hono()

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000
const CHAT_LIMIT_PER_CHANNEL = 60
const CHAT_LIMIT_PER_IP = 30
const EVENTS_LIMIT_PER_IP = 20

/** Best-effort client IP from Cloud Run's forwarding headers. */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return c.req.header('x-real-ip') ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a channel doc by its stored `id` field (collection group query). */
async function findChannel(channelId: string) {
  const snap = await adminDb
    .collectionGroup('channels')
    .where('id', '==', channelId)
    .limit(1)
    .get()
  if (snap.empty) return null
  return snap.docs[0]
}

// ---------------------------------------------------------------------------
// GET /widget/config/:channelId
// ---------------------------------------------------------------------------

widget.get('/config/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Channel not found' }, 404)

  const data = channelDoc.data()
  return c.json({
    agentName: data.config.agentName,
    agentPhotoURL: data.config.agentPhotoURL ?? null,
    widgetColor: data.config.widgetColor,
    widgetPosition: data.config.widgetPosition,
    welcomeMessage: data.config.welcomeMessage,
  })
})

// ---------------------------------------------------------------------------
// POST /widget/chat
// ---------------------------------------------------------------------------

interface ChatBody {
  channelId: string
  conversationId: string
  message: string
  visitorId: string
}

widget.post('/chat', async (c) => {
  const body = await c.req.json<ChatBody>()
  const { channelId, conversationId, message, visitorId } = body

  if (!channelId || !conversationId || !message?.trim() || !visitorId) {
    return c.json({ error: 'channelId, conversationId, message, and visitorId are required' }, 400)
  }

  // Rate limit before any Firestore/LLM work
  const ip = clientIp(c)
  const chLimit = rateLimit(`chat:ch:${channelId}`, CHAT_LIMIT_PER_CHANNEL, RATE_WINDOW_MS)
  const ipLimit = rateLimit(`chat:ip:${ip}`, CHAT_LIMIT_PER_IP, RATE_WINDOW_MS)
  const worst =
    !chLimit.ok && !ipLimit.ok
      ? (chLimit.retryAfterMs >= ipLimit.retryAfterMs ? chLimit : ipLimit)
      : !chLimit.ok
        ? chLimit
        : !ipLimit.ok
          ? ipLimit
          : null
  if (worst) {
    c.header('Retry-After', String(Math.ceil(worst.retryAfterMs / 1000)))
    return c.json({ error: 'Too many requests' }, 429)
  }

  // 1. Look up channel → get workspaceId + agent config
  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Channel not found' }, 404)

  const workspaceId: string = channelDoc.data().workspaceId
  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!workspaceSnap.exists) return c.json({ error: 'Workspace not found' }, 404)

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)

  const workspaceData = workspaceSnap.data()!
  const agent = workspaceData.agent
  const systemPrompt: string = agent.systemPrompt
  const storedModel: string = agent.llmModel ?? 'gemini-flash-latest'
  const llmModel: string = LEGACY_MODEL_MAP[storedModel] ?? storedModel

  const trace = getLangfuse().trace({
    name: 'widget-chat',
    sessionId: conversationId,
    userId: visitorId,
    input: { message: message.trim() },
    metadata: { workspaceId, channelId, llmModel },
  })

  // 2. Get or create conversation
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  // Same ownership gate as the events feed — a leaked conversation id must not
  // let another visitor read or write someone else's conversation.
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (!convSnap.exists) {
    // Billing gate — only NEW conversations are gated; in-progress chats continue.
    const sub = workspaceData.subscription
    const usage = workspaceData.usage ?? {}
    const periodStart = usage.periodStart?.toDate?.() ?? null
    const reset = shouldResetPeriod(periodStart, new Date(), sub)
    const periodUsed = reset ? 0 : (usage.periodConversationCount ?? 0)

    const ent = checkEntitlement({
      subscription: sub,
      periodConversationCount: periodUsed,
      workspaceCreatedAt: workspaceData.createdAt?.toDate?.() ?? new Date(0),
      now: new Date(),
    })
    if (!ent.entitled) {
      return c.json(
        { error: 'This workspace has reached its plan limit or its trial has ended.', reason: ent.reason },
        402,
      )
    }

    await convRef.set({
      channelId,
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: message.trim(),
    })

    // Increment lifetime + period counters; reset the period window if it rolled.
    const update: Record<string, unknown> = {
      'usage.conversationCount': FieldValue.increment(1),
    }
    if (reset) {
      update['usage.periodConversationCount'] = 1
      update['usage.periodStart'] = FieldValue.serverTimestamp()
    } else {
      update['usage.periodConversationCount'] = FieldValue.increment(1)
    }
    await workspaceRef.update(update)
  }

  // 3. Save user message
  const messagesRef = convRef.collection('messages')
  await messagesRef.add({
    role: 'user',
    content: message.trim(),
    createdAt: FieldValue.serverTimestamp(),
  })

  // 4. Fetch conversation history (last 10 messages for context window)
  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(10).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  // 5. Embed user message + query Pinecone
  let contextBlocks: string[] = []
  let sources: Array<{ docId: string; source: string; score: number }> = []

  try {
    const queryEmbedding = await embedText(message.trim(), trace)
    const retrievalSpan = trace.span({
      name: 'pinecone-query',
      input: { topK: 5 },
    })
    const ns = namespaceFor(workspaceId)
    const results = await ns.query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
    retrievalSpan.end({ output: { matches: results.matches?.length ?? 0 } })

    sources = (results.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.6)
      .map((m) => ({
        docId: (m.metadata?.docId as string) ?? '',
        source: (m.metadata?.source as string) ?? '',
        score: m.score ?? 0,
      }))

    contextBlocks = (results.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.6)
      .map((m) => (m.metadata?.text as string) ?? '')
      .filter(Boolean)
  } catch (err) {
    // RAG failure is non-fatal — fall back to no context
    console.warn('[widget/chat] RAG retrieval failed:', err)
  }

  // Resolve provider + key before any streaming (pre-stream errors stay JSON)
  const provider = providerOf(llmModel) ?? 'gemini'
  let keyResult: ReturnType<typeof resolveOpenRouterKey>
  try {
    keyResult = resolveOpenRouterKey(provider, workspaceData.openRouterKey)
  } catch (err) {
    console.error('[widget/chat] key resolution failed:', err)
    return c.json(
      { error: "This agent's AI model needs an OpenRouter API key. Add one in Settings." },
      502,
    )
  }
  if (!keyResult.ok) {
    return c.json(
      { error: "This agent's AI model needs an OpenRouter API key. Add one in Settings." },
      502,
    )
  }

  // 6. Build prompt
  const contextSection =
    contextBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${contextBlocks.join('\n\n')}\n---`
      : ''

  const fullSystemPrompt = systemPrompt + contextSection

  // 7. Stream LLM response as SSE
  const generation = trace.generation({
    name: 'llm-chat',
    model: llmModel,
    input: { system: fullSystemPrompt, messages: history },
  })

  return streamSSE(c, async (stream) => {
    let reply = ''
    let generationEnded = false
    try {
      // Build message history for the LLM (exclude the just-added user msg's duplicate)
      const chatMessages = history.slice(0, -1).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }))
      chatMessages.push({ role: 'user', content: message.trim() })

      const gen = streamChat({
        model: llmModel,
        systemPrompt: fullSystemPrompt,
        messages: chatMessages,
        apiKey: keyResult.apiKey,
      })

      let promptTokens = 0
      let completionTokens = 0
      while (true) {
        const next = await gen.next()
        if (next.done) {
          promptTokens = next.value.promptTokens
          completionTokens = next.value.completionTokens
          break
        }
        reply += next.value.text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: next.value.text }) })
      }
      reply = reply.trim()

      generation.end({
        output: reply,
        usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens },
      })
      generationEnded = true

      // 8. Save assistant message
      const messageRef = await messagesRef.add({
        role: 'assistant',
        content: reply,
        createdAt: FieldValue.serverTimestamp(),
        metadata: { sources, llmModel, promptTokens, completionTokens },
      })

      trace.update({ output: { message: reply, sources } })
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ conversationId, messageId: messageRef.id, sources }),
      })

      // Best-effort bookkeeping — the client already has its reply
      try {
        await convRef.update({
          updatedAt: FieldValue.serverTimestamp(),
          lastMessage: reply.slice(0, 200),
        })
        await workspaceRef.update({
          'usage.messageCount': FieldValue.increment(2), // user + assistant
          'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
        })
      } catch (err) {
        console.warn('[widget/chat] post-reply bookkeeping failed:', err)
      }
    } catch (err) {
      console.error('[widget/chat] LLM stream failed:', err)
      if (!generationEnded) {
        generation.end({
          level: 'ERROR',
          statusMessage: err instanceof Error ? err.message : String(err),
        })
      }
      trace.update({ output: { error: 'llm_failed' } })
      await stream
        .writeSSE({ event: 'error', data: JSON.stringify({ error: 'Failed to generate response' }) })
        .catch(() => {})
    }
  })
})

// ---------------------------------------------------------------------------
// GET /widget/conversations/:conversationId/events
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 25_000

widget.get('/conversations/:conversationId/events', async (c) => {
  const conversationId = c.req.param('conversationId')
  const channelId = c.req.query('channelId')
  const visitorId = c.req.query('visitorId')
  if (!channelId || !visitorId) {
    return c.json({ error: 'channelId and visitorId are required' }, 400)
  }

  const ip = clientIp(c)
  const evLimit = rateLimit(`events:ip:${ip}`, EVENTS_LIMIT_PER_IP, RATE_WINDOW_MS)
  if (!evLimit.ok) {
    c.header('Retry-After', String(Math.ceil(evLimit.retryAfterMs / 1000)))
    return c.json({ error: 'Too many requests' }, 429)
  }

  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Not found' }, 404)

  const workspaceId: string = channelDoc.data().workspaceId
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  // visitorId must match — conversation IDs are client-generated; this prevents
  // one visitor subscribing to another visitor's conversation.
  if (!convSnap.exists || convSnap.data()!.visitorId !== visitorId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const connectedAt = new Date()
  let lastStatus: string = convSnap.data()!.status

  return streamSSE(c, async (stream) => {
    let closed = false

    let unsubConv: (() => void) | null = null
    let unsubMessages: (() => void) | null = null
    const cleanup = () => {
      if (closed) return
      closed = true
      unsubConv?.()
      unsubMessages?.()
    }

    unsubConv = convRef.onSnapshot(
      (snap) => {
        const status = snap.data()?.status
        if (status && status !== lastStatus) {
          lastStatus = status
          stream.writeSSE({ event: 'status', data: JSON.stringify({ status }) }).catch(() => {})
        }
      },
      (err) => {
        console.warn('[widget/events] conversation listener error:', err)
        cleanup() // end the stream so the client reconnects instead of hanging
      },
    )

    unsubMessages = convRef
      .collection('messages')
      .where('createdAt', '>', connectedAt)
      .orderBy('createdAt', 'asc')
      .onSnapshot(
        (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue
            const data = change.doc.data()
            if (data.role === 'user') continue // the visitor typed it themselves
            stream
              .writeSSE({
                event: 'message',
                data: JSON.stringify({ id: change.doc.id, role: data.role, content: data.content }),
              })
              .catch(() => {})
          }
        },
        (err) => {
          console.warn('[widget/events] messages listener error:', err)
          cleanup() // end the stream so the client reconnects instead of hanging
        },
      )

    stream.onAbort(cleanup)

    try {
      while (!closed) {
        await stream.sleep(HEARTBEAT_MS)
        if (closed) break
        await stream.writeSSE({ event: 'ping', data: '' })
      }
    } catch {
      // client went away mid-write
    } finally {
      cleanup()
    }
  })
})

export default widget
