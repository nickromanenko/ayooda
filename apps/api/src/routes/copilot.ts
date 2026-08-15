/**
 * Copilot routes — authenticated, per-team-member internal chat with the workspace's agents.
 *
 * Threads live at workspaces/{ws}/copilotUsers/{uid}/threads/{threadId}. The {uid} segment
 * is the privacy mechanism: a thread belonging to another member is not addressable under
 * this path, so a cross-user attempt simply 404s rather than needing an ownership check.
 *
 * There is deliberately no "create thread" route — POST /copilot/chat takes either a
 * threadId (continue) or an agentId (start) and creates the thread only once the turn is
 * known to be preparable, so empty threads are structurally impossible.
 *
 * GET    /copilot/agents         — minimal agent list for the picker (member-readable)
 * GET    /copilot/threads        — the caller's own threads, newest first
 * POST   /copilot/chat           — SSE. threadId to continue, agentId to start.
 * DELETE /copilot/threads/:id    — delete one of the caller's own threads
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { FieldValue } from 'firebase-admin/firestore'
import type { Subscription } from '@ayooda/shared'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { rateLimit } from '../lib/rate-limit'
import { checkCopilotEntitlement } from '../lib/billing/copilot-entitlement'
import { shouldResetPeriod } from '../lib/billing/entitlement'
import { copilotThreadsPath, prepareCopilotTurn } from '../lib/chat/copilot-turn'
import { runAgentTurn } from '../lib/chat/tools'

const copilot = new Hono<{ Variables: AuthVariables }>()
copilot.use('*', requireAuth)

const TITLE_MAX = 80
const LAST_MESSAGE_MAX = 200
const CHAT_LIMIT_PER_USER = 30
const RATE_WINDOW_MS = 60_000

// ---------------------------------------------------------------------------
// Pure helpers (tested in ./copilot-helpers.test.ts)
// ---------------------------------------------------------------------------

export function threadTitle(message: string): string {
  const t = message.trim()
  return t ? t.slice(0, TITLE_MAX) : 'New thread'
}

type Fail = { ok: false; error: string }
export function validateChatBody(
  raw: unknown,
): { ok: true; value: { message: string; threadId?: string; agentId?: string } } | Fail {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request body.' }
  const o = raw as Record<string, unknown>
  const message = typeof o.message === 'string' ? o.message.trim() : ''
  if (!message) return { ok: false, error: 'message is required.' }
  const threadId = typeof o.threadId === 'string' ? o.threadId : undefined
  const agentId = typeof o.agentId === 'string' ? o.agentId : undefined
  if (!threadId && !agentId) return { ok: false, error: 'Either threadId or agentId is required.' }
  if (threadId && agentId) return { ok: false, error: 'Send threadId to continue or agentId to start, not both.' }
  return { ok: true, value: { message, ...(threadId ? { threadId } : {}), ...(agentId ? { agentId } : {}) } }
}

const threadsCol = (ws: string, uid: string) => adminDb.collection(copilotThreadsPath(ws, uid))

/** Firestore Timestamps come back with .toDate() — convert the subscription's date
 *  fields to real Date objects the same way agent-turn.ts / billing.ts do, otherwise
 *  the >= comparisons inside shouldResetPeriod/checkCopilotEntitlement silently misbehave. */
function toSubscription(raw: unknown): Subscription | undefined {
  if (!raw) return undefined
  const r = raw as Subscription & { trialEndsAt?: unknown; currentPeriodEnd?: unknown }
  return {
    ...r,
    trialEndsAt: (r.trialEndsAt as { toDate?: () => Date })?.toDate?.() ?? (r.trialEndsAt as Date | null) ?? null,
    currentPeriodEnd:
      (r.currentPeriodEnd as { toDate?: () => Date })?.toDate?.() ?? (r.currentPeriodEnd as Date | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// GET /copilot/agents
// ---------------------------------------------------------------------------

/** GET /copilot/agents — minimal agent list for the picker. Members may read this;
 *  the full /agents routes stay owner-only because they expose prompts and config. */
copilot.get('/agents', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/agents`).get()
  const agents = snap.docs
    .map((d) => ({
      id: d.id,
      name: d.data().name as string,
      photoURL: (d.data().photoURL ?? null) as string | null,
      isDefault: d.data().isDefault === true,
    }))
    .sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))
  return c.json({ agents })
})

// ---------------------------------------------------------------------------
// GET /copilot/threads
// ---------------------------------------------------------------------------

copilot.get('/threads', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const snap = await threadsCol(ws, uid).orderBy('updatedAt', 'desc').limit(50).get()
  return c.json({ threads: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })
})

// ---------------------------------------------------------------------------
// DELETE /copilot/threads/:id
// ---------------------------------------------------------------------------

copilot.delete('/threads/:id', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const ref = threadsCol(ws, uid).doc(c.req.param('id'))
  const msgs = await ref.collection('messages').get()
  for (const d of msgs.docs) await d.ref.delete()
  await ref.delete()
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /copilot/chat — SSE. threadId to continue, agentId to start.
// ---------------------------------------------------------------------------

copilot.post('/chat', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')

  const limit = rateLimit(`copilot:${uid}`, CHAT_LIMIT_PER_USER, RATE_WINDOW_MS)
  if (!limit.ok) {
    c.header('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)))
    return c.json({ error: 'Too many requests' }, 429)
  }

  const parsed = validateChatBody(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const { message, threadId, agentId } = parsed.value

  let resolvedThreadId = threadId
  let resolvedAgentId = agentId
  /** Set on the create branch; run only once the turn is known to be preparable, so a
   *  turn that can never reach the model neither creates a thread nor spends a cap unit. */
  let commitNewThread: (() => Promise<void>) | null = null

  if (resolvedThreadId) {
    // A thread belonging to another user is not addressable under this path, so
    // a cross-user attempt simply 404s without an ownership comparison.
    const snap = await threadsCol(ws, uid).doc(resolvedThreadId).get()
    if (!snap.exists) return c.json({ error: 'Thread not found' }, 404)
    resolvedAgentId = snap.data()!.agentId as string

    // Status-only entitlement check. The cap is deliberately per-thread, so an existing
    // thread must NOT be counted against copilotCap — hence copilotPeriodCount: 0, which
    // leaves only the status ladder able to fail this. Without it a canceled workspace or
    // an expired trial could keep reaching the paid LLM forever on threads it already has.
    // An active/past_due subscription whose tier can't be resolved still fails open.
    const wsSnap = await adminDb.doc(`workspaces/${ws}`).get()
    const ent = checkCopilotEntitlement({
      subscription: toSubscription(wsSnap.data()?.subscription),
      copilotPeriodCount: 0,
      now: new Date(),
    })
    if (!ent.entitled) {
      return c.json(
        { error: 'Internal chat needs an active subscription.', reason: 'copilot_limit' },
        402,
      )
    }
  } else {
    const agentSnap = await adminDb.doc(`workspaces/${ws}/agents/${resolvedAgentId}`).get()
    if (!agentSnap.exists) return c.json({ error: 'Agent not found' }, 404)

    // The cap is checked once per thread, on creation — never per message.
    const wsRef = adminDb.doc(`workspaces/${ws}`)
    const wsSnap = await wsRef.get()
    const wsData = wsSnap.data() ?? {}
    const usage = wsData.usage ?? {}
    const now = new Date()
    const sub = toSubscription(wsData.subscription)

    // Copilot must perform the SAME period rollover prepareTurn does. It is the
    // only other writer of this counter, and a workspace that uses Copilot but
    // has no customer traffic would otherwise never advance periodStart — the
    // cap would be permanently exhausted after the first period.
    const periodStart = usage.periodStart?.toDate?.() ?? usage.periodStart ?? null
    const reset = shouldResetPeriod(periodStart, now, sub)
    const effectiveCount = reset ? 0 : (usage.copilotPeriodCount ?? 0)

    const ent = checkCopilotEntitlement({ subscription: sub, copilotPeriodCount: effectiveCount, now })
    // Key the 402 off `entitled`, never off `reason`: in the active/past_due branch an
    // over-cap workspace returns entitled:false with reason 'ok' or 'past_due', so
    // branching on reason would wrongly admit it. This route's own error payload uses
    // the literal string 'copilot_limit' as its reason — unrelated to ent.reason.
    if (!ent.entitled) {
      return c.json(
        { error: `Internal chat limit reached (${ent.cap} threads this period).`, reason: 'copilot_limit' },
        402,
      )
    }

    // .doc() only mints an id — nothing is written yet. Both the thread document and the
    // cap unit are committed below, after prepareCopilotTurn proves the turn is viable.
    // A workspace with no AI Gateway key fails prepare deterministically on EVERY attempt,
    // so writing either one first would let it burn its whole allowance on empty threads
    // and never see a reply. A failed prepare still leaves the user message it wrote under
    // an unreferenced thread id — invisible to every listing, and no cap unit spent.
    const ref = threadsCol(ws, uid).doc()
    resolvedThreadId = ref.id
    commitNewThread = async () => {
      await ref.set({
        uid,
        agentId: resolvedAgentId,
        title: threadTitle(message),
        createdAt: now,
        updatedAt: now,
        lastMessage: message.slice(0, LAST_MESSAGE_MAX),
      })

      // Both counters share one periodStart, so a rollover must reset BOTH in a single
      // update. Advancing periodStart while leaving periodConversationCount high would
      // block the workspace's real customers — far worse than the bug this fixes. No
      // customer conversation happened here, hence 0.
      //
      // usage.periodStart is written by two independent writers on possibly different
      // Cloud Run instances (this route and agent-turn.ts's customer gate). Use the server
      // timestamp for the persisted boundary so clock skew between instances can't move it
      // backwards; `now` (already computed above) still drives the in-process
      // shouldResetPeriod/checkCopilotEntitlement comparisons.
      await wsRef.update(
        reset
          ? { 'usage.periodStart': FieldValue.serverTimestamp(), 'usage.periodConversationCount': 0, 'usage.copilotPeriodCount': 1 }
          : { 'usage.copilotPeriodCount': FieldValue.increment(1) },
      )
    }
  }

  const prepared = await prepareCopilotTurn({
    workspaceId: ws,
    uid,
    threadId: resolvedThreadId!,
    agentId: resolvedAgentId!,
    message,
  })
  if (prepared.kind === 'error') return c.json({ error: prepared.error }, 502)
  if (commitNewThread) await commitNewThread()

  return streamSSE(c, async (stream) => {
    let reply = ''
    try {
      const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools)
      while (true) {
        const next = await gen.next()
        if (next.done) break
        reply += next.value.text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: next.value.text }) })
      }
      const messageId = await prepared.persist(reply)
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ threadId: resolvedThreadId, messageId, sources: prepared.sources }),
      })
    } catch (err) {
      console.error('[copilot] stream failed:', err)
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Something went wrong' }) }).catch(() => {})
    }
  })
})

export default copilot
