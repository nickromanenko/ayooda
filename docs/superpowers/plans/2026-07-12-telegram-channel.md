# Ayooda Telegram Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-12-telegram-channel-design.md`: a per-workspace Telegram bot whose messages run through the same RAG pipeline, conversations/inbox, human takeover, and billing gate as the web widget.

**Architecture:** Extract the widget's inline RAG orchestration into a channel-agnostic `prepareTurn` (billing gate → conversation setup → RAG → key resolution → prompt + a persist closure), reused by both the widget (SSE streaming) and a new Telegram webhook (accumulate + sendMessage). Per-workspace bot token stored AES-256-GCM encrypted; webhook secured by Telegram's secret-token header.

**Tech Stack:** Hono 4 on Bun, `fetch` (Telegram Bot API, no SDK), firebase-admin 12, existing crypto/entitlement/openrouter libs, Next.js 16, `bun test`.

## Global Constraints

- **Per-workspace bot token**, AES-256-GCM encrypted via existing `apps/api/src/lib/crypto.ts` (`encryptSecret`/`decryptSecret`). Never returned by any endpoint.
- **Text-only** v1: non-text updates get "I can only read text right now."
- Bot **stays silent** when a conversation is in `human` status (save the message, no auto-reply).
- Telegram new conversations go through the same `checkEntitlement` gate as the widget.
- Webhook is **public**, authed by matching Telegram's `X-Telegram-Bot-Api-Secret-Token` header to the channel's stored `webhookSecret` (mismatch → 401; unknown channel → 200 + warn; handler errors → 200 + log).
- No new npm dependencies (Telegram via `fetch`).
- The `prepareTurn` refactor MUST preserve the widget's exact behavior (token streaming, pre-stream 402 gate, 502 key error).
- Env: `API_PUBLIC_URL` (HTTPS base for webhook registration) — document in `apps/api/.env.example`. `TELEGRAM_BOT_API_KEY` in `.env` is the test bot token.
- `@ayooda/shared` builds to `dist/` — run `pnpm --filter @ayooda/shared build` after editing it. `apps/web` is Next.js 16 (client components here). Run `corepack enable` if `pnpm` is missing.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Shared types for Telegram channels + conversations

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `ConversationDoc.channelType?`, `ConversationDoc.telegramChatId?`; `ChannelDoc` optional telegram fields. Tasks 4–7 read these.

_No unit test — type-only additions; the compile is the check._

- [ ] **Step 1: Extend the types**

In `packages/shared/src/index.ts`:
- In `ConversationDoc`, add `channelType?: ChannelType` and `telegramChatId?: number`.
- In `ChannelDoc`, add optional server-only fields: `botTokenEnc?: string`, `webhookSecret?: string`, `telegram?: { botUsername: string; botId: number }`. (`config`/`embedCode` stay optional-compatible — they are web-widget-specific; if `ChannelDoc` currently requires `config`/`embedCode`, make them optional since a telegram channel has neither.)

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @ayooda/shared build && pnpm -r typecheck`
Expected: PASS. If making `config`/`embedCode` optional breaks a web-widget consumer that assumes them present, leave those consumers alone (they only read web_widget channels) — only fix a real compile error.

- [ ] **Step 3: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): telegram channel + conversation channelType fields"
```

---

### Task 2: Telegram update parser (pure)

**Files:**
- Create: `apps/api/src/lib/telegram/update.ts`
- Create: `apps/api/src/lib/telegram/update.test.ts`

**Interfaces:**
- Produces: `parseUpdate(update: unknown): ParsedUpdate` where `ParsedUpdate = {kind:'text', chatId, userId, text} | {kind:'nontext', chatId, userId} | {kind:'ignore'}`. Task 6 calls it.

- [ ] **Step 1: Write the failing test** — `apps/api/src/lib/telegram/update.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { parseUpdate } from './update'

describe('parseUpdate', () => {
  test('text message', () => {
    expect(parseUpdate({ message: { chat: { id: 42 }, from: { id: 7 }, text: 'hello' } }))
      .toEqual({ kind: 'text', chatId: 42, userId: 7, text: 'hello' })
  })
  test('message without text → nontext', () => {
    expect(parseUpdate({ message: { chat: { id: 42 }, from: { id: 7 }, photo: [{}] } }))
      .toEqual({ kind: 'nontext', chatId: 42, userId: 7 })
  })
  test('empty/whitespace text → nontext', () => {
    expect(parseUpdate({ message: { chat: { id: 1 }, from: { id: 2 }, text: '   ' } }))
      .toEqual({ kind: 'nontext', chatId: 1, userId: 2 })
  })
  test('edited_message → ignore', () => {
    expect(parseUpdate({ edited_message: { chat: { id: 1 }, from: { id: 2 }, text: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('channel_post → ignore', () => {
    expect(parseUpdate({ channel_post: { chat: { id: 1 }, text: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('callback_query → ignore', () => {
    expect(parseUpdate({ callback_query: { id: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('missing message → ignore', () => {
    expect(parseUpdate({})).toEqual({ kind: 'ignore' })
    expect(parseUpdate(null)).toEqual({ kind: 'ignore' })
  })
  test('message missing chat/from → ignore', () => {
    expect(parseUpdate({ message: { text: 'x' } })).toEqual({ kind: 'ignore' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/telegram/update.test.ts`
Expected: FAIL — cannot resolve `./update`.

- [ ] **Step 3: Implement `apps/api/src/lib/telegram/update.ts`**

```ts
export type ParsedUpdate =
  | { kind: 'text'; chatId: number; userId: number; text: string }
  | { kind: 'nontext'; chatId: number; userId: number }
  | { kind: 'ignore' }

interface TgMessage {
  chat?: { id?: number }
  from?: { id?: number }
  text?: string
}

/** Parse a Telegram Update into a channel-agnostic shape. Only private `message` updates are actionable. */
export function parseUpdate(update: unknown): ParsedUpdate {
  const u = update as { message?: TgMessage } | null
  const msg = u?.message
  if (!msg) return { kind: 'ignore' } // edited_message / channel_post / callback_query / etc.

  const chatId = msg.chat?.id
  const userId = msg.from?.id
  if (typeof chatId !== 'number' || typeof userId !== 'number') return { kind: 'ignore' }

  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  if (text.length === 0) return { kind: 'nontext', chatId, userId }
  return { kind: 'text', chatId, userId, text }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/telegram/update.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/telegram/update.ts apps/api/src/lib/telegram/update.test.ts
git commit -m "feat(api): telegram update parser"
```

---

### Task 3: Telegram Bot API client

**Files:**
- Create: `apps/api/src/lib/telegram/client.ts`
- Create: `apps/api/src/lib/telegram/client.test.ts`

**Interfaces:**
- Produces: `getMe(token)`, `setWebhook(token, url, secretToken)`, `deleteWebhook(token)`, `sendMessage(token, chatId, text)`. Tasks 5–7 call these.

- [ ] **Step 1: Write the failing test** — `apps/api/src/lib/telegram/client.test.ts`:

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { getMe, sendMessage } from './client'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function okResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('telegram client', () => {
  test('getMe returns the bot info and calls the right URL', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (url: string) => { calledUrl = url; return okResponse({ id: 1, username: 'my_bot', first_name: 'My' }) }) as unknown as typeof fetch
    const me = await getMe('TOK')
    expect(me).toEqual({ id: 1, username: 'my_bot', first_name: 'My' })
    expect(calledUrl).toBe('https://api.telegram.org/botTOK/getMe')
  })
  test('sendMessage posts chat_id + text', async () => {
    let body = ''
    globalThis.fetch = (async (_url: string, init: RequestInit) => { body = init.body as string; return okResponse({ message_id: 9 }) }) as unknown as typeof fetch
    await sendMessage('TOK', 42, 'hi there')
    const parsed = JSON.parse(body)
    expect(parsed).toEqual({ chat_id: 42, text: 'hi there' })
  })
  test('throws on a non-ok Telegram response', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })) as unknown as typeof fetch
    await expect(getMe('BAD')).rejects.toThrow('Unauthorized')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/telegram/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement `apps/api/src/lib/telegram/client.ts`**

```ts
const API = 'https://api.telegram.org'

interface TgResponse<T> { ok: boolean; result?: T; description?: string }

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as TgResponse<T>
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`)
  }
  return data.result as T
}

export interface BotInfo { id: number; username: string; first_name: string }

/** GET-style with no body; Telegram accepts POST for all methods, so reuse call(). */
export function getMe(token: string): Promise<BotInfo> {
  return call<BotInfo>(token, 'getMe')
}

export function setWebhook(token: string, url: string, secretToken: string): Promise<boolean> {
  return call<boolean>(token, 'setWebhook', { url, secret_token: secretToken, allowed_updates: ['message'] })
}

export function deleteWebhook(token: string): Promise<boolean> {
  return call<boolean>(token, 'deleteWebhook', {})
}

export function sendMessage(token: string, chatId: number, text: string): Promise<{ message_id: number }> {
  return call<{ message_id: number }>(token, 'sendMessage', { chat_id: chatId, text })
}
```

Note: the `getMe` test asserts the URL is `.../botTOK/getMe`; `call` uses `fetch(url, {method:'POST'})` — the test only checks the URL string, so POST is fine. (Telegram accepts POST for `getMe`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/telegram/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/telegram/client.ts apps/api/src/lib/telegram/client.test.ts
git commit -m "feat(api): telegram bot API client"
```

---

### Task 4: Extract `prepareTurn` + refactor the widget handler

**Files:**
- Create: `apps/api/src/lib/chat/agent-turn.ts`
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `embedText`, `namespaceFor`, `getLangfuse`, `adminDb`, `streamChat`'s `ChatParams`, `resolveOpenRouterKey`, `providerOf`, `LEGACY_MODEL_MAP`, `checkEntitlement`, `shouldResetPeriod`.
- Produces: `prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn>` — the shared pre-LLM orchestration + gate + a `persist` closure. Task 6 (Telegram) calls it too.

_No new unit test for prepareTurn itself (its parts are already unit-tested: entitlement, openrouter, crypto); the widget E2E in Task 9 re-verifies the whole path. This task's gate is: widget behavior preserved + typecheck._

- [ ] **Step 1: Create `apps/api/src/lib/chat/agent-turn.ts`**

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../firebase-admin'
import { embedText, LEGACY_MODEL_MAP } from '../gemini'
import { getLangfuse, type LangfuseTrace } from '../langfuse'
import { namespaceFor } from '../pinecone'
import { streamChat, type ChatParams } from '../llm/openrouter'
import { resolveOpenRouterKey } from '../llm/resolve'
import { providerOf, type ChannelType } from '@ayooda/shared'
import { checkEntitlement, shouldResetPeriod, type GateReason } from '../billing/entitlement'

export interface PrepareTurnInput {
  workspaceId: string
  channelId: string
  conversationId: string
  visitorId: string
  message: string
  channelType: ChannelType
  telegramChatId?: number
}

export interface ReadyTurn {
  kind: 'ready'
  chatParams: ChatParams
  sources: Array<{ docId: string; source: string; score: number }>
  trace: LangfuseTrace
  llmModel: string
  persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
}

export type PreparedTurn =
  | { kind: 'gated'; reason: GateReason }
  | { kind: 'error'; error: string }
  | ReadyTurn

/**
 * Channel-agnostic agent turn: billing gate → conversation setup → RAG → key resolution
 * → prompt + ChatParams, plus a persist() closure. The caller drives streamChat (SSE for the
 * widget, accumulate+sendMessage for Telegram) and calls persist() with the final reply.
 */
export async function prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn> {
  const { workspaceId, channelId, conversationId, visitorId, message, channelType, telegramChatId } = input
  const trimmed = message.trim()

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)
  const workspaceSnap = await workspaceRef.get()
  if (!workspaceSnap.exists) return { kind: 'error', error: 'Workspace not found' }
  const workspaceData = workspaceSnap.data()!

  const agent = workspaceData.agent
  const systemPrompt: string = agent.systemPrompt
  const storedModel: string = agent.llmModel ?? 'gemini-flash-latest'
  const llmModel: string = LEGACY_MODEL_MAP[storedModel] ?? storedModel

  const trace = getLangfuse().trace({
    name: 'agent-chat',
    sessionId: conversationId,
    userId: visitorId,
    input: { message: trimmed },
    metadata: { workspaceId, channelId, channelType, llmModel },
  })

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return { kind: 'error', error: 'Not found' }
  }

  if (!convSnap.exists) {
    // Billing gate — only NEW conversations are gated.
    const rawSub = workspaceData.subscription
    const sub = rawSub
      ? {
          ...rawSub,
          trialEndsAt: rawSub.trialEndsAt?.toDate?.() ?? rawSub.trialEndsAt ?? null,
          currentPeriodEnd: rawSub.currentPeriodEnd?.toDate?.() ?? rawSub.currentPeriodEnd ?? null,
        }
      : undefined
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
    if (!ent.entitled) return { kind: 'gated', reason: ent.reason }

    await convRef.set({
      channelId,
      channelType,
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: trimmed,
      ...(telegramChatId !== undefined ? { telegramChatId } : {}),
    })
    const update: Record<string, unknown> = { 'usage.conversationCount': FieldValue.increment(1) }
    if (reset) {
      update['usage.periodConversationCount'] = 1
      update['usage.periodStart'] = FieldValue.serverTimestamp()
    } else {
      update['usage.periodConversationCount'] = FieldValue.increment(1)
    }
    await workspaceRef.update(update)
  }

  const messagesRef = convRef.collection('messages')
  await messagesRef.add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })

  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(10).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  // RAG (non-fatal)
  let contextBlocks: string[] = []
  let sources: Array<{ docId: string; source: string; score: number }> = []
  try {
    const queryEmbedding = await embedText(trimmed, trace)
    const retrievalSpan = trace.span({ name: 'pinecone-query', input: { topK: 5 } })
    const results = await namespaceFor(workspaceId).query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
    retrievalSpan.end({ output: { matches: results.matches?.length ?? 0 } })
    const good = (results.matches ?? []).filter((m) => (m.score ?? 0) > 0.6)
    sources = good.map((m) => ({ docId: (m.metadata?.docId as string) ?? '', source: (m.metadata?.source as string) ?? '', score: m.score ?? 0 }))
    contextBlocks = good.map((m) => (m.metadata?.text as string) ?? '').filter(Boolean)
  } catch (err) {
    console.warn('[agent-turn] RAG retrieval failed:', err)
  }

  // Key resolution
  const provider = providerOf(llmModel) ?? 'gemini'
  let keyResult
  try {
    keyResult = resolveOpenRouterKey(provider, workspaceData.openRouterKey)
  } catch (err) {
    console.error('[agent-turn] key resolution failed:', err)
    return { kind: 'error', error: 'AI model needs an API key' }
  }
  if (!keyResult.ok) return { kind: 'error', error: 'AI model needs an API key' }

  const contextSection =
    contextBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${contextBlocks.join('\n\n')}\n---`
      : ''
  const fullSystemPrompt = systemPrompt + contextSection

  const chatMessages = history.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))
  chatMessages.push({ role: 'user', content: trimmed })

  const persist = async (reply: string, promptTokens: number, completionTokens: number): Promise<string> => {
    const messageRef = await messagesRef.add({
      role: 'assistant',
      content: reply,
      createdAt: FieldValue.serverTimestamp(),
      metadata: { sources, llmModel, promptTokens, completionTokens },
    })
    try {
      await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200) })
      await workspaceRef.update({
        'usage.messageCount': FieldValue.increment(2),
        'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
      })
    } catch (err) {
      console.warn('[agent-turn] post-reply bookkeeping failed:', err)
    }
    trace.update({ output: { message: reply, sources } })
    return messageRef.id
  }

  return {
    kind: 'ready',
    chatParams: { model: llmModel, systemPrompt: fullSystemPrompt, messages: chatMessages, apiKey: keyResult.apiKey },
    sources,
    trace,
    llmModel,
    persist,
  }
}
```

- [ ] **Step 2: Refactor `apps/api/src/routes/widget.ts` `POST /chat` to use prepareTurn**

Keep the handler's body-validation, rate limit, and channel lookup (through `const workspaceId = channelDoc.data().workspaceId`). Replace everything from the workspace load through the end of the `streamSSE` block with:

```ts
  const { prepareTurn } = await import('../lib/chat/agent-turn')
  const prepared = await prepareTurn({
    workspaceId, channelId, conversationId, visitorId, message, channelType: 'web_widget',
  })

  if (prepared.kind === 'gated') {
    return c.json({ error: 'This workspace has reached its plan limit or its trial has ended.', reason: prepared.reason }, 402)
  }
  if (prepared.kind === 'error') {
    return c.json({ error: "This agent's AI model needs an OpenRouter API key. Add one in Settings." }, 502)
  }

  const { chatParams, sources, trace, llmModel, persist } = prepared
  const generation = trace.generation({ name: 'llm-chat', model: llmModel, input: { system: chatParams.systemPrompt, messages: chatParams.messages } })

  return streamSSE(c, async (stream) => {
    let reply = ''
    let generationEnded = false
    try {
      const gen = streamChat(chatParams)
      let promptTokens = 0
      let completionTokens = 0
      while (true) {
        const next = await gen.next()
        if (next.done) { promptTokens = next.value.promptTokens; completionTokens = next.value.completionTokens; break }
        reply += next.value.text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: next.value.text }) })
      }
      reply = reply.trim()
      generation.end({ output: reply, usage: { input: promptTokens, output: completionTokens, total: promptTokens + completionTokens } })
      generationEnded = true

      const messageId = await persist(reply, promptTokens, completionTokens)
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, messageId, sources }) })
    } catch (err) {
      console.error('[widget/chat] LLM stream failed:', err)
      if (!generationEnded) generation.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      trace.update({ output: { error: 'llm_failed' } })
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Failed to generate response' }) }).catch(() => {})
    }
  })
```

Then remove the now-dead code the handler no longer uses: the direct workspace/agent/model resolution, the inline trace creation, the conversation get/create + gate + counter block, the user-message save, the history fetch, the RAG block, the key resolution block, and the prompt building — all of that now lives in `prepareTurn`. Remove any imports that became unused in `widget.ts` (e.g. `embedText`, `namespaceFor`, `checkEntitlement`, `shouldResetPeriod`, `providerOf`, `resolveOpenRouterKey`, `LEGACY_MODEL_MAP`, `FieldValue` if no longer used elsewhere in the file — grep before removing; the events endpoint and config endpoint may still use some). Keep `streamChat`, `streamSSE`, `findChannel`, `rateLimit`, `adminDb` (events endpoint), `getLangfuse` only if still referenced.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. Grep the chat handler to confirm the old inline RAG/gate code is gone and not duplicated: `grep -n "checkEntitlement\|embedText\|resolveOpenRouterKey" apps/api/src/routes/widget.ts` should show no hits in the `/chat` handler (only possibly in the events endpoint, which doesn't use them — so ideally zero).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/chat/agent-turn.ts apps/api/src/routes/widget.ts
git commit -m "refactor(api): extract prepareTurn; widget chat uses shared agent turn"
```

---

### Task 5: Connect / disconnect Telegram (channels route)

**Files:**
- Modify: `apps/api/src/routes/channels.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `getMe`, `setWebhook`, `deleteWebhook` (Task 3); `encryptSecret` (crypto).
- Produces: `POST /channels/telegram`, `DELETE /channels/telegram`; `GET /channels` strips telegram secrets. Task 8 calls these.

_No unit test — Telegram/Firestore I/O; verified in Task 9._

- [ ] **Step 1: Add imports + a random-secret helper**

In `apps/api/src/routes/channels.ts`, add:

```ts
import { randomBytes } from 'crypto'
import { encryptSecret } from '../lib/crypto'
import { getMe, setWebhook, deleteWebhook } from '../lib/telegram/client'
```

- [ ] **Step 2: Strip telegram secrets from `GET /channels`**

The existing `GET /` maps `snap.docs` to `{ id, ...d.data() }`. Change it to drop server-only fields:

```ts
  return c.json(snap.docs.map((d) => {
    const { botTokenEnc, webhookSecret, ...safe } = d.data() as Record<string, unknown>
    return { id: d.id, ...safe }
  }))
```

- [ ] **Step 3: Add `POST /channels/telegram`**

```ts
/** POST /channels/telegram — connect a workspace's Telegram bot */
channels.post('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ botToken?: string }>()
  const botToken = body.botToken?.trim()
  if (!botToken) return c.json({ error: 'botToken is required' }, 400)

  const apiBase = process.env.API_PUBLIC_URL
  if (!apiBase) return c.json({ error: 'Server not configured for webhooks (API_PUBLIC_URL)' }, 500)

  // Validate the token
  let bot
  try {
    bot = await getMe(botToken)
  } catch {
    return c.json({ error: 'Invalid bot token' }, 400)
  }

  // One telegram channel per workspace: reuse the existing doc id if present
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .where('type', '==', 'telegram')
    .limit(1)
    .get()
  const channelRef = existing.empty
    ? adminDb.collection(`workspaces/${workspaceId}/channels`).doc()
    : existing.docs[0].ref
  const channelId = channelRef.id
  const webhookSecret = randomBytes(24).toString('hex')

  await setWebhook(botToken, `${apiBase}/telegram/webhook/${channelId}`, webhookSecret)

  await channelRef.set({
    workspaceId,
    id: channelId,
    type: 'telegram',
    botTokenEnc: encryptSecret(botToken),
    webhookSecret,
    telegram: { botUsername: bot.username, botId: bot.id },
    isActive: true,
    createdAt: new Date(),
  })

  return c.json({ channelId, botUsername: bot.username })
})
```

- [ ] **Step 4: Add `DELETE /channels/telegram`**

```ts
/** DELETE /channels/telegram — disconnect the bot */
channels.delete('/telegram', async (c) => {
  const workspaceId = c.get('workspaceId')
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/channels`)
    .where('type', '==', 'telegram')
    .limit(1)
    .get()
  if (existing.empty) return c.json({ ok: true })

  const doc = existing.docs[0]
  const enc = doc.data().botTokenEnc as string | undefined
  if (enc) {
    try {
      const { decryptSecret } = await import('../lib/crypto')
      await deleteWebhook(decryptSecret(enc))
    } catch (err) {
      console.warn('[channels/telegram] deleteWebhook failed:', err)
    }
  }
  await doc.ref.delete()
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Document env + typecheck + commit**

In `apps/api/.env.example`, add: `API_PUBLIC_URL= # public HTTPS base URL of the API, for Telegram webhook registration (e.g. https://api.ayooda.live)`.

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/routes/channels.ts apps/api/.env.example
git commit -m "feat(api): connect/disconnect Telegram bot per workspace"
```

---

### Task 6: Inbound Telegram webhook

**Files:**
- Create: `apps/api/src/routes/telegram.ts`
- Modify: `apps/api/src/index.ts` (mount `/telegram`)

**Interfaces:**
- Consumes: `parseUpdate` (Task 2); `sendMessage` (Task 3); `prepareTurn` (Task 4); `decryptSecret`; `adminDb`; `streamChat`.
- Produces: `POST /telegram/webhook/:channelId` (public). Task 9 drives it with a synthetic update.

_No unit test — integration; verified in Task 9._

- [ ] **Step 1: Create `apps/api/src/routes/telegram.ts`**

```ts
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
```

- [ ] **Step 2: Mount the route**

In `apps/api/src/index.ts`, add `import telegramRoutes from './routes/telegram'` with the others, and `app.route('/telegram', telegramRoutes)` — place it near the `/widget` mount. The webhook is public (no auth middleware); the CORS `*` on `/widget/*` doesn't apply, but Telegram doesn't send an Origin, so the default CORS is fine. (No `requireAuth` anywhere in this router.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/routes/telegram.ts apps/api/src/index.ts
git commit -m "feat(api): inbound Telegram webhook — RAG reply + human-silence + gate"
```

---

### Task 7: Operator takeover delivery to Telegram

**Files:**
- Modify: `apps/api/src/routes/conversations.ts`

**Interfaces:**
- Consumes: `sendMessage` (Task 3), `decryptSecret`, `adminDb`.
- Produces: operator messages on telegram conversations are delivered to the chat.

_No unit test — I/O; verified in Task 9._

- [ ] **Step 1: Deliver operator messages to Telegram**

In `apps/api/src/routes/conversations.ts` `POST /:id/messages`, after the existing operator-message save + conversation update + `usage.messageCount` increment, and before the final `return`, add:

```ts
  // If this is a Telegram conversation, mirror the operator reply into the chat.
  const conv = convSnap.data()!
  if (conv.channelType === 'telegram' && typeof conv.telegramChatId === 'number') {
    try {
      const chSnap = await adminDb
        .collection(`workspaces/${workspaceId}/channels`)
        .where('type', '==', 'telegram')
        .limit(1)
        .get()
      const enc = chSnap.docs[0]?.data().botTokenEnc as string | undefined
      if (enc) {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendMessage } = await import('../lib/telegram/client')
        await sendMessage(decryptSecret(enc), conv.telegramChatId, body.content.trim())
      }
    } catch (err) {
      console.warn('[conversations] telegram operator delivery failed:', err)
    }
  }
```

(`convSnap` is already loaded earlier in the handler; reuse it.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/routes/conversations.ts
git commit -m "feat(api): deliver operator replies to Telegram chats"
```

---

### Task 8: Web — Connect Telegram card

**Files:**
- Modify: `apps/web/src/app/dashboard/channels/page.tsx`

**Interfaces:**
- Consumes: `POST /channels/telegram`, `DELETE /channels/telegram`, `GET /channels` (Tasks 5).
- Produces: the Telegram connect UI.

_No unit test — UI; verified in Task 9._

- [ ] **Step 1: Read the current channels page**

Read `apps/web/src/app/dashboard/channels/page.tsx` to match its state/style idiom (it already fetches `GET /channels` and shows the web widget + a "coming soon" area).

- [ ] **Step 2: Add a Telegram card**

Add a Telegram section (client component patterns already in the file). It should:
- From the `GET /channels` list, find a `type === 'telegram'` channel. If present, show "Connected as @{telegram.botUsername}" and a **Disconnect** button → `DELETE /channels/telegram` → refetch.
- If absent, show a password input for the bot token + **Connect** button → `POST /channels/telegram { botToken }` → on success refetch; on error show the returned `{error}` inline. Include the hint: "Create a bot with @BotFather and paste its token here."
- Use the same `apiRequest` client and the page's existing inline-style idiom (cards, buttons). Token input is write-only (never pre-filled). Escape any apostrophes in copy with `&apos;` to avoid new lint errors.

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: typecheck + build PASS; lint shows only the pre-existing failures (none new in `channels/page.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/channels/page.tsx
git commit -m "feat(web): connect/disconnect Telegram bot on the channels page"
```

---

### Task 9: Verification + docs

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm --filter web build`
Expected: all pass (parser 8 + client 3 tests added; existing suites green).

- [ ] **Step 2: Widget regression (the prepareTurn refactor)**

With `apps/api/.env` (real `OPENROUTER_API_KEY`) and a real channel id, start the API and confirm the widget path still works via the shared prepareTurn: `POST /widget/chat` streams `chunk`→`done` (200 SSE); an over-cap/trial-expired workspace still returns pre-stream `402`; a Claude/OpenAI model with no key still returns `502`. (Reuse the token/curl approach from prior rounds' `.superpowers/sdd/` scripts.)

- [ ] **Step 3: Telegram live E2E (real `TELEGRAM_BOT_API_KEY`)**

Set `API_PUBLIC_URL=https://api.ayooda.live` in `apps/api/.env` (a real HTTPS URL Telegram's `setWebhook` accepts — reachability isn't required for these checks). Start the API. With a minted ID token:
1. **Connect:** `POST /channels/telegram { botToken: <TELEGRAM_BOT_API_KEY> }` → `{ channelId, botUsername }`. Confirm via a scratch script calling Telegram `getWebhookInfo` that the webhook URL is set to `https://api.ayooda.live/telegram/webhook/<channelId>`.
2. **No leak:** `GET /channels` returns the telegram channel with `telegram.botUsername` but NO `botTokenEnc`/`webhookSecret`.
3. **Inbound (synthetic):** POST a synthetic Telegram Update to `http://localhost:3001/telegram/webhook/<channelId>` with header `X-Telegram-Bot-Api-Secret-Token: <the channel's webhookSecret>` (read it from Firestore in a scratch script) and body `{"message":{"chat":{"id":<YOUR_TEST_CHAT_ID>},"from":{"id":<YOUR_TEST_CHAT_ID>},"text":"What do you offer?"}}`. Expect 200; confirm a `user` + `assistant` message were persisted in `workspaces/<ws>/conversations/tg_<chatId>` and the assistant `sendMessage` was attempted (it succeeds and reaches the phone only if `<YOUR_TEST_CHAT_ID>` is a real chat that has started the bot — otherwise Telegram returns "chat not found", which still proves the pipeline ran; note which). Wrong secret header → 401.
4. **Human silence:** set that conversation's `status` to `human` (scratch), POST another synthetic update → expect the message saved but NO new assistant message (bot silent).
5. **Operator delivery:** `POST /conversations/tg_<chatId>/messages { content: "Operator here" }` → attempts a Telegram `sendMessage` to the chat (verify the call; delivery to the phone again requires a real chat).
6. **Gate:** a trial-expired/over-cap workspace → the synthetic inbound sends "temporarily unavailable" instead of an answer.
Record verified vs. deferred. **Deferred (documented):** a true phone round-trip (real Telegram account → bot → reply on device) needs `API_PUBLIC_URL` to be a reachable HTTPS endpoint and you to message the bot. Clean up: `DELETE /channels/telegram` (removes the webhook + channel) and delete any `tg_*` test conversations.

- [ ] **Step 4: Update `docs/architecture.md`**

Add Telegram to the channels section: per-workspace encrypted bot token, `POST/DELETE /channels/telegram`, the public `POST /telegram/webhook/:channelId` (secret-token auth), the shared `prepareTurn` agent turn (widget + Telegram), human-silence behavior, operator delivery, billing parity, and the `API_PUBLIC_URL` env var. Note conversations now carry `channelType`/`telegramChatId`.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: architecture updates for the Telegram channel"
```
