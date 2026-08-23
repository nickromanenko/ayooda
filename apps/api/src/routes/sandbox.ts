/** Authenticated agent sandbox. Sessions are intentionally stored outside the
 * production `conversations` collection so test traffic never reaches inbox,
 * scoring, hand-off analytics, confidence trends, or conversation quotas. */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { adminDb } from '../lib/firebase-admin'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import {
  isSandboxSessionId,
  sandboxSessionPath,
  sandboxSessionsPath,
  validateSandboxChatBody,
} from '../lib/chat/sandbox-session'
import { rateLimit } from '../lib/rate-limit'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'

const sandbox = new Hono<{ Variables: AuthVariables }>()
sandbox.use('*', requireAuth)
sandbox.use('*', requireAgent)

const CHAT_LIMIT_PER_USER = 30
const RATE_WINDOW_MS = 60_000

sandbox.post('/chat', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const uid = c.get('uid')
  const limited = rateLimit(`sandbox:${uid}:${agentId}`, CHAT_LIMIT_PER_USER, RATE_WINDOW_MS)
  if (!limited.ok) {
    c.header('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)))
    return c.json({ error: 'Too many test messages. Please wait a moment.' }, 429)
  }

  const parsed = validateSandboxChatBody(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const { message, allowTools } = parsed.value
  const sessionId = parsed.value.sessionId
    ?? adminDb.collection(sandboxSessionsPath(workspaceId, uid)).doc().id

  const prepared = await prepareTurn({
    workspaceId,
    agentId,
    channelId: 'sandbox',
    channelType: 'sandbox',
    conversationId: sessionId,
    visitorId: `sandbox_${uid}_${agentId}`,
    message,
    sandbox: { ownerUid: uid, allowTools },
  })

  if (prepared.kind === 'gated') {
    return c.json({ error: 'Sandbox testing needs an active plan or trial.', reason: prepared.reason }, 402)
  }
  if (prepared.kind === 'error') return c.json({ error: prepared.error }, 502)

  if (prepared.kind === 'silent') {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId, sources: [], status: 'waiting', silent: true }),
      })
    })
  }

  if (prepared.kind === 'escalated') {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: prepared.message }) })
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId, sources: prepared.sources, status: 'waiting', escalated: true }),
      })
    })
  }

  const generation = prepared.trace.generation({
    name: 'llm-chat',
    model: prepared.llmModel,
    input: { system: prepared.chatParams.systemPrompt, messages: prepared.chatParams.messages },
  })

  return streamSSE(c, async (stream) => {
    let reply = ''
    let generationEnded = false
    try {
      const gen = runAgentTurn(
        prepared.chatParams,
        prepared.tools,
        prepared.trace,
        {},
        prepared.skillTools,
        prepared.mcpTools,
      )
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
      const messageId = await prepared.persist(reply, promptTokens, completionTokens)
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId, messageId, sources: prepared.sources, status: 'bot' }),
      })
    } catch (err) {
      console.error('[sandbox] stream failed:', err)
      if (!generationEnded) {
        generation.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      }
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Could not generate a test reply.' }) }).catch(() => {})
    }
  })
})

sandbox.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  if (!isSandboxSessionId(sessionId)) return c.json({ error: 'Invalid sessionId.' }, 400)

  const ref = adminDb.doc(sandboxSessionPath(c.get('workspaceId'), c.get('uid'), sessionId))
  await adminDb.recursiveDelete(ref)
  return c.json({ ok: true })
})

export default sandbox
