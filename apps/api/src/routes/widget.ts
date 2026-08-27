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
import { adminDb } from '../lib/firebase-admin'
import { canHideBranding } from '../lib/channels/branding'
import { runAgentTurn } from '../lib/chat/tools'
import { rateLimit } from '../lib/rate-limit'
import { DEFAULT_WIDGET_APPEARANCE } from '@ayooda/shared'

const widget = new Hono()

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000
const CHAT_LIMIT_PER_CHANNEL = 60
const CHAT_LIMIT_PER_IP = 30
const EVENTS_LIMIT_PER_IP = 20
const CONFIG_HEARTBEATS_PER_IP = 120

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

function requestHostname(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const value = c.req.header('origin') ?? c.req.header('referer')
  if (!value) return null
  try { return new URL(value).hostname.toLowerCase() } catch { return null }
}

function domainAllowed(c: { req: { header: (name: string) => string | undefined } }, data: { config?: { allowedDomains?: unknown } }): boolean {
  const allowed = Array.isArray(data.config?.allowedDomains) ? data.config.allowedDomains as string[] : []
  if (allowed.length === 0) return true
  const host = requestHostname(c)
  if (!host) return false
  return allowed.some((domain) => domain.startsWith('*.')
    ? host.endsWith(domain.slice(1)) && host !== domain.slice(2)
    : host === domain)
}

// ---------------------------------------------------------------------------
// GET /widget/config/:channelId
// ---------------------------------------------------------------------------

widget.get('/config/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Channel not found' }, 404)

  const data = channelDoc.data()
  if (data.isActive === false) return c.json({ error: 'This widget is paused.' }, 404)
  if (!domainAllowed(c, data)) return c.json({ error: 'This widget is not allowed on this domain.' }, 403)
  const config = { ...DEFAULT_WIDGET_APPEARANCE, ...(data.config ?? {}) }
  const originHeader = c.req.header('origin') ?? c.req.header('referer')
  let lastSeenOrigin: string | null = null
  if (originHeader) {
    try { lastSeenOrigin = new URL(originHeader).hostname } catch { /* malformed headers are ignored */ }
  }

  // This is also the installation heartbeat shown in Deploy. It records only
  // the host, never a customer page path or query string.
  if (rateLimit(`widget-config:${clientIp(c)}`, CONFIG_HEARTBEATS_PER_IP, RATE_WINDOW_MS).ok) {
    void channelDoc.ref.update({
      lastSeenAt: new Date(),
      'stats.views': FieldValue.increment(1),
      ...(lastSeenOrigin ? {
        lastSeenOrigin,
        observedDomains: [...new Set([...(Array.isArray(data.observedDomains) ? data.observedDomains : []).slice(-19), lastSeenOrigin])],
      } : {}),
    }).catch((err) => console.warn('[widget] installation heartbeat failed:', err))
  }

  // The channel carries a cached copy of the agent's name and photo, refreshed
  // only when a channel is reassigned to a different agent. Renaming an agent or
  // uploading a logo would therefore never reach an already-embedded widget, so
  // read the agent live and fall back to the cache only if it has gone.
  // Appearance (colour, position, welcome message) stays channel-level.
  let agentName: string = config.agentName
  let agentPhotoURL: string | null = config.agentPhotoURL ?? null
  const workspaceId = channelDoc.ref.parent.parent?.id
  const agentId = data.agentId as string | undefined
  if (workspaceId && agentId) {
    try {
      const agentSnap = await adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}`).get()
      if (agentSnap.exists) {
        const a = agentSnap.data()!
        agentName = a.name ?? agentName
        agentPhotoURL = a.photoURL ?? null
      }
    } catch (err) {
      // Non-fatal: a stale name beats a widget that fails to load.
      console.warn('[widget] live agent lookup failed, using cached identity:', err)
    }
  }

  // Branding is re-checked here, not just when it is saved: a workspace that
  // turned the line off on a paid plan and later downgraded or lapsed must get
  // it back, and this endpoint is the only thing the embedded widget trusts.
  let showBranding = config.showBranding !== false
  if (!showBranding && workspaceId) {
    try {
      const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
      if (!canHideBranding(wsSnap.data()?.subscription)) showBranding = true
    } catch (err) {
      // Fail closed — a lookup failure must not silently strip attribution.
      console.warn('[widget] branding tier check failed, showing the line:', err)
      showBranding = true
    }
  }

  return c.json({
    ...config,
    agentName,
    agentPhotoURL,
    showBranding,
    allowedDomains: undefined,
  })
})

// ---------------------------------------------------------------------------
// POST /widget/event — small, privacy-safe engagement counters
// ---------------------------------------------------------------------------

widget.post('/event', async (c) => {
  const body: { channelId?: string; event?: string } = await c.req
    .json<{ channelId?: string; event?: string }>()
    .catch(() => ({}))
  if (!body.channelId || !['open', 'conversation_started'].includes(body.event ?? '')) {
    return c.json({ error: 'Invalid widget event.' }, 400)
  }
  const limit = rateLimit(`widget-event:${clientIp(c)}`, 120, RATE_WINDOW_MS)
  if (!limit.ok) return c.json({ ok: true })
  const channelDoc = await findChannel(body.channelId)
  if (!channelDoc || channelDoc.data().isActive === false || !domainAllowed(c, channelDoc.data())) {
    return c.json({ error: 'Not found' }, 404)
  }
  const field = body.event === 'open' ? 'stats.opens' : 'stats.conversations'
  await channelDoc.ref.update({ [field]: FieldValue.increment(1) })
  return c.json({ ok: true })
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
  if (!domainAllowed(c, channelDoc.data())) return c.json({ error: 'This widget is not allowed on this domain.' }, 403)

  const workspaceId: string = channelDoc.data().workspaceId

  const { prepareTurn } = await import('../lib/chat/agent-turn')
  const prepared = await prepareTurn({
    workspaceId, channelId, conversationId, visitorId, message, channelType: 'web_widget',
    agentId: channelDoc.data().agentId,
  })

  if (prepared.kind === 'gated') {
    return c.json({ error: 'This workspace has reached its plan limit or its trial has ended.', reason: prepared.reason }, 402)
  }
  if (prepared.kind === 'error') {
    return c.json({ error: "This agent's AI model needs an OpenRouter API key. Add one in Settings." }, 502)
  }

  if (prepared.kind === 'silent') {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, sources: [] }) })
    })
  }
  if (prepared.kind === 'workflow') {
    const message = prepared.message
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: message }) })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, messageId: prepared.messageId, sources: prepared.sources, status: prepared.status, workflowAction: prepared.action }) })
    })
  }

  const { chatParams, sources, trace, llmModel, tools, skillTools, mcpTools, persist } = prepared
  const generation = trace.generation({ name: 'llm-chat', model: llmModel, input: { system: chatParams.systemPrompt, messages: chatParams.messages } })

  return streamSSE(c, async (stream) => {
    let generated = ''
    let generationEnded = false
    try {
      if (prepared.prefix) {
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: `${prepared.prefix}\n\n` }) })
      }
      const gen = runAgentTurn(chatParams, tools, trace, {}, skillTools, mcpTools)
      let promptTokens = 0
      let completionTokens = 0
      while (true) {
        const next = await gen.next()
        if (next.done) { promptTokens = next.value.promptTokens; completionTokens = next.value.completionTokens; break }
        generated += next.value.text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: next.value.text }) })
      }
      generated = generated.trim()
      generation.end({ output: generated, usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens } })
      generationEnded = true

      const reply = [prepared.prefix, generated].filter(Boolean).join('\n\n')
      const messageId = await persist(reply, promptTokens, completionTokens)
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, messageId, sources }) })
    } catch (err) {
      console.error('[widget/chat] LLM stream failed:', err)
      if (!generationEnded) generation.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      trace.update({ output: { error: 'llm_failed' } })
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Failed to generate response' }) }).catch(() => {})
    }
  })
})

// ---------------------------------------------------------------------------
// GET /widget/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

widget.get('/conversations/:conversationId/messages', async (c) => {
  const conversationId = c.req.param('conversationId')
  const channelId = c.req.query('channelId')
  const visitorId = c.req.query('visitorId')
  if (!channelId || !visitorId) return c.json({ error: 'channelId and visitorId are required' }, 400)

  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Not found' }, 404)
  if (channelDoc.data().isActive === false) return c.json({ error: 'Not found' }, 404)
  if (!domainAllowed(c, channelDoc.data())) return c.json({ error: 'Not found' }, 404)

  const workspaceId: string = channelDoc.data().workspaceId
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists || convSnap.data()!.visitorId !== visitorId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const snapshot = await convRef.collection('messages').orderBy('createdAt', 'desc').limit(50).get()
  const messages = snapshot.docs.reverse().map((doc) => {
    const data = doc.data()
    return { id: doc.id, role: data.role, content: data.content }
  })
  return c.json({ messages, status: convSnap.data()!.status ?? 'bot' })
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
  if (channelDoc.data().isActive === false) return c.json({ error: 'Not found' }, 404)
  if (!domainAllowed(c, channelDoc.data())) return c.json({ error: 'Not found' }, 404)

  const workspaceId: string = channelDoc.data().workspaceId
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  // visitorId must match — conversation IDs are client-generated; this prevents
  // one visitor subscribing to another visitor's conversation.
  if (!convSnap.exists || convSnap.data()!.visitorId !== visitorId) {
    return c.json({ error: 'Not found' }, 404)
  }

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
      .orderBy('createdAt', 'asc')
      .limitToLast(100)
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
