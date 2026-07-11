# Ayooda v1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four v1 gaps from `docs/superpowers/specs/2026-07-11-v1-completion-design.md`: SSE streaming chat, widget live event feed (operator takeover delivery), knowledge-base file uploads, and real dashboard metrics with usage tracking.

**Architecture:** The Hono/Bun API gains two SSE surfaces (streaming `POST /widget/chat`, new `GET /widget/conversations/:id/events` backed by server-side Firestore listeners) plus a multipart `POST /knowledge/upload` that stores files in Firebase Storage and triggers the existing Cloud Run job, generalized into an ingestor with a file-extraction branch. The vanilla-TS widget gains an SSE parser, incremental rendering, and an auto-reconnecting EventSource feed. The Next.js dashboard overview becomes a server component reading real Firestore aggregates; usage counters are incremented in the chat pipeline.

**Tech Stack:** Hono 4 (`streamSSE` from `hono/streaming`), Bun, firebase-admin 12 (Firestore `onSnapshot`, `getStorage`), `@google/generative-ai` (`generateContentStream`), pdf-parse, mammoth, Vite/vanilla TS widget, Next.js 16 App Router.

## Global Constraints

- Monorepo: pnpm workspaces. `@ayooda/shared` compiles to `dist/` — after editing it, run `pnpm --filter @ayooda/shared build` or dependents won't see changes.
- `apps/web` is **Next.js 16** — per `apps/web/AGENTS.md`, read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing App Router code; APIs differ from training data (e.g. `cookies()` is async, middleware is `src/proxy.ts`).
- API runs on **Bun**; scraper runs on **Node** (tsc build). Unit tests use `bun test` in all packages (pure logic only — no Firestore/network in unit tests).
- Public widget endpoints stay unauthenticated but must validate `channelId` (and `visitorId` for the events feed). Never expose data across workspaces or visitors.
- Upload limits (exact values, also exported from shared): extensions `.pdf .docx .txt .csv .md`, `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`.
- SSE streams must always terminate with a `done` or `error` event (chat) or clean close (events feed); detach Firestore listeners on disconnect.
- Existing style: no semicolons-optional style varies per package — match the file you're editing. Commit after every task.
- All commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Shared types, upload constants, and file validation

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces (used by later tasks): `WorkspaceUsage.messageCount: number`; `ConversationDoc.hadTakeover?: boolean`; `KnowledgeDoc.storagePath?: string`; `ChatRequest.channelId` (renamed from `agentId`); `KNOWLEDGE_FILE_EXTENSIONS: readonly string[]`; `MAX_UPLOAD_BYTES: number`; `validateKnowledgeFile(filename: string, sizeBytes: number): { ok: true } | { ok: false; error: string }`; `ChatStreamEvent`, `ConversationEvent` unions.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/index.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { validateKnowledgeFile, MAX_UPLOAD_BYTES } from './index'

describe('validateKnowledgeFile', () => {
  test('accepts allowed extensions under the size cap', () => {
    for (const name of ['a.pdf', 'b.docx', 'c.txt', 'd.csv', 'e.md', 'F.PDF']) {
      expect(validateKnowledgeFile(name, 1024)).toEqual({ ok: true })
    }
  })
  test('rejects disallowed extensions', () => {
    const res = validateKnowledgeFile('malware.exe', 10)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Unsupported file type')
  })
  test('rejects files without an extension', () => {
    expect(validateKnowledgeFile('README', 10).ok).toBe(false)
  })
  test('rejects files over the size cap', () => {
    const res = validateKnowledgeFile('big.pdf', MAX_UPLOAD_BYTES + 1)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('10 MB')
  })
  test('accepts a file exactly at the cap', () => {
    expect(validateKnowledgeFile('edge.pdf', MAX_UPLOAD_BYTES)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test`
Expected: FAIL — `validateKnowledgeFile` is not exported.

- [ ] **Step 3: Implement in `packages/shared/src/index.ts`**

Apply these edits:

1. In `WorkspaceUsage`, add `messageCount: number` after `conversationCount`.
2. In `ConversationDoc`, add `hadTakeover?: boolean` after `status`.
3. In `KnowledgeDoc`, add `storagePath?: string` after `source`.
4. In `ChatRequest`, rename `agentId: string` → `channelId: string` (the API already reads `channelId`; the type was stale).
5. Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Knowledge file uploads
// ---------------------------------------------------------------------------

export const KNOWLEDGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.csv', '.md'] as const
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function validateKnowledgeFile(
  filename: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()
  if (!(KNOWLEDGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      error: `Unsupported file type "${ext || filename}". Allowed: ${KNOWLEDGE_FILE_EXTENSIONS.join(', ')}`,
    }
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'File is too large. Maximum size is 10 MB.' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// SSE events (widget <-> API)
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: 'chunk'; text: string }
  | {
      type: 'done'
      conversationId: string
      messageId: string
      sources: Array<{ docId: string; source: string; score: number }>
    }
  | { type: 'error'; error: string }

export type ConversationEvent =
  | { type: 'message'; id: string; role: MessageRole; content: string }
  | { type: 'status'; status: ConversationStatus }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && bun test`
Expected: PASS (5 tests).

- [ ] **Step 5: Build shared and typecheck dependents**

Run: `pnpm --filter @ayooda/shared build && pnpm -r typecheck`
Expected: shared builds; if `apps/web` fails on the `ChatRequest.agentId` rename, grep for usages (`grep -rn "agentId" apps/web/src apps/api/src`) — the API sends/reads `channelId` already; fix any stale reference to the renamed field (do not touch the widget's `data-agent-id` HTML attribute, which is the public embed API).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): upload validation, SSE event types, usage/takeover fields"
```

---

### Task 2: Usage counters + hadTakeover flag (API write path)

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (usage seed)
- Modify: `apps/api/src/routes/widget.ts` (conversation-create + token increments)
- Modify: `apps/api/src/routes/conversations.ts` (takeover flag, operator messageCount)

**Interfaces:**
- Consumes: `WorkspaceUsage.messageCount` from Task 1.
- Produces: workspace docs whose `usage.{conversationCount,messageCount,tokenCount}` are live counters and conversations with `hadTakeover: true` after takeover — Task 10 reads these.

_No unit test — these are Firestore side effects with no emulator harness in this repo; verified by typecheck now and the E2E checklist in Task 11._

- [ ] **Step 1: Seed `messageCount` for new workspaces**

In `apps/api/src/routes/auth.ts`, find the workspace-creation payload containing `usage: { conversationCount: 0, tokenCount: 0 }` and change it to `usage: { conversationCount: 0, messageCount: 0, tokenCount: 0 }`.

- [ ] **Step 2: Increment counters in `apps/api/src/routes/widget.ts`**

In the `POST /chat` handler: after `const workspaceSnap = ...` add a ref (`const workspaceRef = adminDb.doc(\`workspaces/${workspaceId}\`)` — reuse it). Inside the `if (!convSnap.exists)` branch, after `convRef.set({...})`, add:

```ts
    await workspaceRef.update({ 'usage.conversationCount': FieldValue.increment(1) })
```

After the assistant message is saved and the conversation updated (currently steps 8–9, near the end of the handler), add:

```ts
  await workspaceRef.update({
    'usage.messageCount': FieldValue.increment(2), // user + assistant
    'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
  })
```

(In Task 3 this handler is restructured for streaming — keep these increments in the same logical positions there.)

- [ ] **Step 3: Set `hadTakeover` and count operator messages in `apps/api/src/routes/conversations.ts`**

In `POST /:id/takeover`, add `hadTakeover: true,` to the `convRef.update({...})` payload.

In `POST /:id/messages`, after the existing `convRef.update({...})`, add:

```ts
  await adminDb
    .doc(`workspaces/${workspaceId}`)
    .update({ 'usage.messageCount': FieldValue.increment(1) })
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/routes/widget.ts apps/api/src/routes/conversations.ts
git commit -m "feat(api): live usage counters and hadTakeover flag"
```

---

### Task 3: Streaming `POST /widget/chat` (SSE)

**Files:**
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `ChatStreamEvent` shape from Task 1 (events named `chunk`/`done`/`error`, JSON data).
- Produces: `POST /widget/chat` responds `text/event-stream` emitting `event: chunk` `data: {"text": "..."}` deltas, then `event: done` `data: {"conversationId","messageId","sources"}`, or `event: error` `data: {"error"}`. Pre-stream validation failures still return JSON 4xx. Task 5's widget client parses exactly this.

- [ ] **Step 1: Restructure the handler for streaming**

In `apps/api/src/routes/widget.ts`, add the import:

```ts
import { streamSSE } from 'hono/streaming'
```

Keep everything through prompt-building (steps 1–6: validation → channel/workspace lookup → Langfuse trace → conversation get/create **with the Task 2 conversationCount increment** → save user message → history fetch → RAG retrieval → `fullSystemPrompt`/`contents`) exactly as is — these run before the stream starts so validation errors stay JSON. Then replace step 7 ("Call Gemini") through the final `return c.json(...)` with:

```ts
  // 7. Stream Gemini response as SSE
  const generation = trace.generation({
    name: 'gemini-chat',
    model: llmModel,
    input: { system: fullSystemPrompt, messages: contents },
  })

  return streamSSE(c, async (stream) => {
    let reply = ''
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      const model = genAI.getGenerativeModel({
        model: llmModel,
        systemInstruction: fullSystemPrompt,
      })
      const result = await model.generateContentStream({ contents })

      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (!text) continue
        reply += text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text }) })
      }

      const response = await result.response
      reply = reply.trim()
      const promptTokens = response.usageMetadata?.promptTokenCount ?? 0
      const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0
      generation.end({
        output: reply,
        usage: {
          input: promptTokens,
          output: completionTokens,
          total: promptTokens + completionTokens,
        },
      })

      // 8. Save assistant message
      const messageRef = await messagesRef.add({
        role: 'assistant',
        content: reply,
        createdAt: FieldValue.serverTimestamp(),
        metadata: { sources, llmModel, promptTokens, completionTokens },
      })

      // 9. Update conversation + usage counters
      await convRef.update({
        updatedAt: FieldValue.serverTimestamp(),
        lastMessage: reply.slice(0, 200),
      })
      await workspaceRef.update({
        'usage.messageCount': FieldValue.increment(2), // user + assistant
        'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
      })

      trace.update({ output: { message: reply, sources } })
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ conversationId, messageId: messageRef.id, sources }),
      })
    } catch (err) {
      console.error('[widget/chat] Gemini stream failed:', err)
      generation.end({
        level: 'ERROR',
        statusMessage: err instanceof Error ? err.message : String(err),
      })
      trace.update({ output: { error: 'gemini_failed' } })
      await stream
        .writeSSE({ event: 'error', data: JSON.stringify({ error: 'Failed to generate response' }) })
        .catch(() => {})
    }
  })
```

Delete the now-dead non-streaming Gemini call, old steps 8–9, and the old `return c.json({ conversationId, message: reply, sources })`. The Task 2 counter increments now live inside the stream callback as shown — make sure they aren't duplicated outside it.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke-test the stream locally**

Requires `apps/api/.env` with real `GEMINI_API_KEY` etc. (see `apps/api/.env.example`) and at least one existing channel. Start: `pnpm --filter api dev`, then:

```bash
curl -N -s -X POST http://localhost:3001/widget/chat \
  -H 'Content-Type: application/json' \
  -d '{"channelId":"<real-channel-id>","conversationId":"test-stream-1","message":"Hello","visitorId":"test-visitor"}'
```

Expected: several `event: chunk` frames followed by one `event: done` frame with a `messageId`. Also verify a bad channel returns JSON 404 (not a stream). If no local env is configured, note it and rely on Task 11 verification.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/widget.ts
git commit -m "feat(api): stream widget chat responses via SSE"
```

---

### Task 4: `GET /widget/conversations/:conversationId/events` (live feed)

**Files:**
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `findChannel` helper (already in the file); `ConversationEvent` shape from Task 1.
- Produces: public SSE endpoint — query params `channelId`, `visitorId` (both required). Emits `event: message` `data: {"id","role","content"}` for non-`user` messages created after connect, `event: status` `data: {"status"}` on status change, `event: ping` heartbeat every 25s. 404 for unknown/mismatched conversation. Task 6's widget consumes this.

- [ ] **Step 1: Add the endpoint**

Append to `apps/api/src/routes/widget.ts` (before `export default widget`):

```ts
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

    const unsubConv = convRef.onSnapshot(
      (snap) => {
        const status = snap.data()?.status
        if (status && status !== lastStatus) {
          lastStatus = status
          stream.writeSSE({ event: 'status', data: JSON.stringify({ status }) }).catch(() => {})
        }
      },
      (err) => console.warn('[widget/events] conversation listener error:', err),
    )

    const unsubMessages = convRef
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
        (err) => console.warn('[widget/events] messages listener error:', err),
      )

    const cleanup = () => {
      if (closed) return
      closed = true
      unsubConv()
      unsubMessages()
    }
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. (`DocumentReference.onSnapshot`/`Query.onSnapshot` exist in firebase-admin's Firestore; if TS complains about the error-callback overload, use the single-argument form and wrap in try/catch.)

- [ ] **Step 3: Smoke-test locally (if env configured)**

With the API running and a real conversation (create one via the Task 3 curl):

```bash
curl -N -s "http://localhost:3001/widget/conversations/test-stream-1/events?channelId=<real-channel-id>&visitorId=test-visitor"
```

In a second terminal, add an operator message directly (or via dashboard). Expected: a `event: message` frame appears; wrong `visitorId` returns JSON 404 immediately.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/widget.ts
git commit -m "feat(api): live conversation event feed for the widget"
```

---

### Task 5: Widget SSE parser + streaming render

**Files:**
- Create: `apps/widget/src/sse.ts`
- Test: `apps/widget/src/sse.test.ts` (new)
- Modify: `apps/widget/src/index.ts`
- Modify: `apps/widget/package.json` (add `"test": "bun test"` script)

**Interfaces:**
- Consumes: Task 3's stream format.
- Produces: `extractSSEMessages(buffer: string): { messages: Array<{ event: string; data: string }>; rest: string }` (pure, exported from `sse.ts`); `AyoodaWidget` renders chunks incrementally and exposes `renderedIds: Set<string>` + `appendBotMessage` reused by Task 6.

- [ ] **Step 1: Write the failing parser test**

Create `apps/widget/src/sse.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { extractSSEMessages } from './sse'

describe('extractSSEMessages', () => {
  test('parses complete event frames and returns the incomplete tail', () => {
    const buf =
      'event: chunk\ndata: {"text":"Hel"}\n\nevent: chunk\ndata: {"text":"lo"}\n\nevent: do'
    const { messages, rest } = extractSSEMessages(buf)
    expect(messages).toEqual([
      { event: 'chunk', data: '{"text":"Hel"}' },
      { event: 'chunk', data: '{"text":"lo"}' },
    ])
    expect(rest).toBe('event: do')
  })
  test('defaults event name to "message"', () => {
    const { messages } = extractSSEMessages('data: hi\n\n')
    expect(messages).toEqual([{ event: 'message', data: 'hi' }])
  })
  test('joins multi-line data with newlines', () => {
    const { messages } = extractSSEMessages('event: x\ndata: a\ndata: b\n\n')
    expect(messages[0].data).toBe('a\nb')
  })
  test('handles CRLF line endings', () => {
    const { messages, rest } = extractSSEMessages('event: chunk\r\ndata: {"a":1}\r\n\r\n')
    expect(messages).toEqual([{ event: 'chunk', data: '{"a":1}' }])
    expect(rest).toBe('')
  })
  test('empty buffer yields nothing', () => {
    expect(extractSSEMessages('')).toEqual({ messages: [], rest: '' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/widget && bun test`
Expected: FAIL — cannot resolve `./sse`.

- [ ] **Step 3: Implement `apps/widget/src/sse.ts`**

```ts
/**
 * Minimal SSE frame parser for fetch-streamed responses.
 * (EventSource can't POST, so the chat stream is read manually.)
 */

export interface SSEMessage {
  event: string
  data: string
}

export function extractSSEMessages(buffer: string): { messages: SSEMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames = normalized.split('\n\n')
  const rest = frames.pop() ?? ''
  const messages: SSEMessage[] = []

  for (const frame of frames) {
    if (!frame.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    messages.push({ event, data: dataLines.join('\n') })
  }

  return { messages, rest }
}
```

Add to `apps/widget/package.json` scripts: `"test": "bun test"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/widget && bun test`
Expected: PASS (5 tests).

- [ ] **Step 5: Replace the widget's request path with streaming**

In `apps/widget/src/index.ts`:

1. Add the import at the top: `import { extractSSEMessages } from './sse'`
2. Replace the `ChatResponse` interface and `sendMessage` function (lines ~39–43 and ~79–91) with:

```ts
interface ChatDone {
  conversationId: string
  messageId: string
  sources: Array<{ docId: string; source: string; score: number }>
}

const FIRST_CHUNK_TIMEOUT_MS = 30_000

async function sendMessageStream(
  message: string,
  conversationId: string,
  visitorId: string,
  handlers: { onChunk: (text: string) => void; onDone: (done: ChatDone) => void },
): Promise<void> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    FIRST_CHUNK_TIMEOUT_MS,
  )

  const res = await fetch(`${API_BASE}/widget/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: CHANNEL_ID, conversationId, message, visitorId }),
    signal: controller.signal,
  })
  if (!res.ok || !res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('Failed to send message')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { messages, rest } = extractSSEMessages(buffer)
    buffer = rest
    for (const msg of messages) {
      if (timeout) {
        clearTimeout(timeout) // first frame arrived — stop the watchdog
        timeout = null
      }
      if (msg.event === 'chunk') {
        handlers.onChunk((JSON.parse(msg.data) as { text: string }).text)
      } else if (msg.event === 'done') {
        finished = true
        handlers.onDone(JSON.parse(msg.data) as ChatDone)
      } else if (msg.event === 'error') {
        throw new Error((JSON.parse(msg.data) as { error: string }).error)
      }
    }
  }
  if (timeout) clearTimeout(timeout)
  if (!finished) throw new Error('Stream ended without completion')
}
```

3. In the `AyoodaWidget` class, add the field `private renderedIds = new Set<string>()` (Task 6 also uses it), and replace the `submit()` method with:

```ts
  private async submit() {
    const text = this.input.value.trim()
    if (!text || this.sending) return

    this.sending = true
    this.sendBtn.disabled = true
    this.input.value = ''
    this.input.style.height = 'auto'

    this.appendMessage(text, 'user')
    const typingEl = this.showTyping()
    let bubble: HTMLElement | null = null

    try {
      await sendMessageStream(text, this.conversationId, this.visitorId, {
        onChunk: (chunk) => {
          if (!bubble) {
            typingEl.remove()
            bubble = this.appendBotMessage('')
          }
          bubble.textContent += chunk
          this.scrollToBottom()
        },
        onDone: (done) => {
          this.renderedIds.add(done.messageId)
          if (!bubble) {
            // model produced no chunks (empty reply) — show something sane
            typingEl.remove()
            this.appendMessage('Sorry, I could not generate a response.', 'error')
          }
        },
      })
    } catch {
      typingEl.remove()
      if (!bubble) this.appendMessage('Sorry, something went wrong. Please try again.', 'error')
    } finally {
      this.sending = false
      this.sendBtn.disabled = !this.input.value.trim()
    }
  }
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --filter widget typecheck && pnpm --filter widget build`
Expected: both PASS; `apps/widget/dist/widget.js` produced. Note: `tsc --noEmit` must not sweep in the test file if `bun:test` types are missing — if it errors on `sse.test.ts`, add `"exclude": ["src/**/*.test.ts"]` to `apps/widget/tsconfig.json` (bun test still runs it).

- [ ] **Step 7: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): render chat responses as a token stream"
```

---

### Task 6: Widget live event feed (operator messages + status)

**Files:**
- Modify: `apps/widget/src/index.ts`

**Interfaces:**
- Consumes: Task 4's endpoint; `renderedIds` and `appendBotMessage` from Task 5.
- Produces: visitor-facing takeover — operator/assistant messages appear live; system notes on status changes.

- [ ] **Step 1: Add system-note CSS**

In `buildCSS()` in `apps/widget/src/index.ts`, after the `.msg.error` rule, add:

```css
    .msg.system {
      align-self: center;
      background: transparent;
      color: #a1a1aa;
      font-size: 12px;
      padding: 2px 8px;
    }
```

- [ ] **Step 2: Add the feed to `AyoodaWidget`**

Add fields to the class:

```ts
  private eventSource: EventSource | null = null
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private feedSuspended = false // set on immediate failure (conversation may not exist yet)
```

Add methods:

```ts
  private openFeed() {
    if (this.eventSource || this.feedSuspended || !this.open) return
    const url =
      `${API_BASE}/widget/conversations/${this.conversationId}/events` +
      `?channelId=${encodeURIComponent(CHANNEL_ID)}&visitorId=${encodeURIComponent(this.visitorId)}`
    const es = new EventSource(url)
    this.eventSource = es

    es.onopen = () => {
      this.reconnectDelay = 1000
    }

    es.addEventListener('message', (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as { id: string; role: string; content: string }
      if (this.renderedIds.has(msg.id)) return
      this.renderedIds.add(msg.id)
      this.appendBotMessage(msg.content)
    })

    es.addEventListener('status', (e: MessageEvent) => {
      const { status } = JSON.parse(e.data) as { status: string }
      if (status === 'human') this.appendSystemNote("You're now chatting with a human")
      else if (status === 'resolved') this.appendSystemNote('This conversation has been resolved')
    })

    es.onerror = () => {
      es.close()
      this.eventSource = null
      if (es.readyState !== EventSource.CLOSED && this.reconnectDelay === 1000) {
        // never connected (e.g. 404 — no conversation yet): wait for the next send
        this.feedSuspended = true
        return
      }
      if (!this.open) return
      this.reconnectTimer = setTimeout(() => this.openFeed(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
    }
  }

  private closeFeed() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.eventSource?.close()
    this.eventSource = null
  }

  private appendSystemNote(text: string) {
    const div = document.createElement('div')
    div.className = 'msg system'
    div.textContent = text
    this.messages.appendChild(div)
    this.scrollToBottom()
  }
```

Note on `onerror`: `EventSource` gives no HTTP status. The heuristic above treats a failure while still at the initial 1s backoff **before any successful open** as "conversation doesn't exist yet" and suspends; `onopen` resetting `reconnectDelay` means established connections that later drop keep reconnecting. Simpler and equally acceptable: on every error, suspend and let `onDone` re-open — if the branching above proves fiddly during implementation, use the simpler rule; the E2E test in Task 11 step "takeover" is the arbiter.

- [ ] **Step 3: Wire lifecycle hooks**

In `toggle()`, after `this.scrollToBottom()` inside `if (this.open)`, add `this.openFeed()`; add an `else { this.closeFeed() }` branch.

In `submit()`'s `onDone` handler (from Task 5), after `this.renderedIds.add(done.messageId)`, add:

```ts
          this.feedSuspended = false
          this.openFeed()
```

- [ ] **Step 4: Typecheck, build, test**

Run: `pnpm --filter widget typecheck && pnpm --filter widget build && cd apps/widget && bun test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/widget/src/index.ts
git commit -m "feat(widget): live event feed — operator messages and status notes"
```

---

### Task 7: API file upload endpoint + storage + generalized job trigger

**Files:**
- Modify: `apps/api/src/lib/firebase-admin.ts` (storage bucket)
- Modify: `apps/api/src/lib/scraper.ts` (generalize trigger)
- Modify: `apps/api/src/routes/knowledge.ts` (upload endpoint, delete cleanup)
- Modify: `apps/api/.env.example` (document `FIREBASE_STORAGE_BUCKET`)

**Interfaces:**
- Consumes: `validateKnowledgeFile`, `MAX_UPLOAD_BYTES` from Task 1.
- Produces: `POST /knowledge/upload` (multipart field `file`) → `201 {docId, status:'pending'}`; `adminBucket()` helper; `triggerIngestion(params: { workspaceId: string; docId: string; docType: 'webpage' | 'file'; url?: string; storagePath?: string })` (renamed from `triggerScraper`) passing `DOC_TYPE`/`URL`/`STORAGE_PATH` env to the job — Task 8 reads these.

- [ ] **Step 1: Add storage to `apps/api/src/lib/firebase-admin.ts`**

Add import `import { getStorage } from 'firebase-admin/storage'`. In the `AppOptions`, add:

```ts
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`,
```

At the bottom add: `export const adminBucket = () => getStorage().bucket()`

In `apps/api/.env.example`, add a line: `FIREBASE_STORAGE_BUCKET= # optional; defaults to <project-id>.firebasestorage.app`

- [ ] **Step 2: Generalize the trigger in `apps/api/src/lib/scraper.ts`**

Replace `ScraperJobParams` and the env plumbing:

```ts
interface IngestionJobParams {
  workspaceId: string
  docId: string
  docType: 'webpage' | 'file'
  url?: string
  storagePath?: string
}
```

Rename `triggerScraper` → `triggerIngestion` (keep `export function triggerScraper(...)` as a one-line deprecated alias only if other call sites exist — there is exactly one, in `knowledge.ts`, so just rename both). In `triggerCloudRunJob` and `triggerLocal`, build the env as:

```ts
  const jobEnv = [
    { name: 'WORKSPACE_ID', value: params.workspaceId },
    { name: 'DOC_ID', value: params.docId },
    { name: 'DOC_TYPE', value: params.docType },
    ...(params.url ? [{ name: 'URL', value: params.url }] : []),
    ...(params.storagePath ? [{ name: 'STORAGE_PATH', value: params.storagePath }] : []),
  ]
```

(and the object-spread equivalent for `triggerLocal`'s `env`). Update the existing call in `knowledge.ts` `/scrape` to `triggerIngestion({ workspaceId, docId: docRef.id, docType: 'webpage', url: normalised })`.

- [ ] **Step 3: Add the upload endpoint to `apps/api/src/routes/knowledge.ts`**

Add imports:

```ts
import { validateKnowledgeFile } from '@ayooda/shared'
import { adminBucket } from '../lib/firebase-admin'
```

Add after the `/scrape` route:

```ts
/** POST /knowledge/upload — upload a file (pdf/docx/txt/csv/md) for indexing */
knowledge.post('/upload', async (c) => {
  const workspaceId = c.get('workspaceId')

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart form-data)' }, 400)

  const validation = validateKnowledgeFile(file.name, file.size)
  if (!validation.ok) {
    return c.json({ error: validation.error }, file.size > 0 && validation.error.includes('10 MB') ? 413 : 400)
  }

  // Dedupe by filename within the workspace
  const existing = await adminDb
    .collection(`workspaces/${workspaceId}/knowledge`)
    .where('source', '==', file.name)
    .where('type', '==', 'file')
    .limit(1)
    .get()
  if (!existing.empty) {
    return c.json({ error: `"${file.name}" has already been uploaded` }, 409)
  }

  const docRef = adminDb.collection(`workspaces/${workspaceId}/knowledge`).doc()
  const storagePath = `workspaces/${workspaceId}/knowledge/${docRef.id}/${file.name}`

  await adminBucket()
    .file(storagePath)
    .save(Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream',
    })

  await docRef.set({
    type: 'file',
    source: file.name,
    storagePath,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    createdAt: new Date(),
    indexedAt: null,
  })

  triggerIngestion({ workspaceId, docId: docRef.id, docType: 'file', storagePath })

  return c.json({ docId: docRef.id, status: 'pending' }, 201)
})
```

- [ ] **Step 4: Clean up stored files on delete**

In the `DELETE /:id` handler, after the Pinecone best-effort block, add:

```ts
  const { storagePath } = snap.data() as { storagePath?: string }
  if (storagePath) {
    try {
      await adminBucket().file(storagePath).delete()
    } catch (err) {
      console.warn(`[knowledge] Storage delete failed for doc ${docId}:`, err)
    }
  }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): knowledge file uploads to Storage + generalized ingestion trigger"
```

---

### Task 8: Ingestor — file extraction branch in the scraper job

**Files:**
- Create: `apps/scraper/src/extract.ts`
- Test: `apps/scraper/src/extract.test.ts` (new)
- Modify: `apps/scraper/src/index.ts`
- Modify: `apps/scraper/package.json` (deps: `pdf-parse@^1.1.1`, `mammoth@^1.8.0`, `@types/pdf-parse` dev; script `"test": "bun test"`)
- Modify: `apps/scraper/.env.example` (document `DOC_TYPE`, `STORAGE_PATH`, `FIREBASE_STORAGE_BUCKET`)

**Interfaces:**
- Consumes: env contract from Task 7 (`DOC_TYPE`, `STORAGE_PATH`); existing `chunkText`, `embedBatch`, `upsertVectors` in `index.ts`.
- Produces: `extractText(filename: string, buffer: Buffer): Promise<string>` — throws on unsupported extension or empty result.

- [ ] **Step 1: Install deps**

```bash
pnpm --filter scraper add pdf-parse@^1.1.1 mammoth@^1.8.0
pnpm --filter scraper add -D @types/pdf-parse
```

- [ ] **Step 2: Write the failing test**

Create `apps/scraper/src/extract.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { extractText } from './extract'

describe('extractText', () => {
  test('reads txt/md/csv as UTF-8', async () => {
    expect(await extractText('a.txt', Buffer.from('hello world'))).toBe('hello world')
    expect(await extractText('b.md', Buffer.from('# Title\nBody'))).toBe('# Title\nBody')
    expect(await extractText('c.csv', Buffer.from('col1,col2\n1,2'))).toBe('col1,col2\n1,2')
  })
  test('is case-insensitive on extension', async () => {
    expect(await extractText('NOTES.TXT', Buffer.from('x'))).toBe('x')
  })
  test('rejects unsupported extensions', async () => {
    await expect(extractText('x.exe', Buffer.from('x'))).rejects.toThrow('Unsupported file type')
  })
  test('rejects empty extraction', async () => {
    await expect(extractText('empty.txt', Buffer.from('   '))).rejects.toThrow('No text content')
  })
})
```

(PDF/DOCX parsing is exercised in the Task 11 E2E pass with real files — generating valid binary fixtures inline is not worth the brittleness.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/scraper && bun test`
Expected: FAIL — cannot resolve `./extract`.

- [ ] **Step 4: Implement `apps/scraper/src/extract.ts`**

```ts
import mammoth from 'mammoth'

/**
 * Extract plain text from an uploaded knowledge file.
 * Supported: .pdf, .docx, .txt, .csv, .md — throws on anything else or empty output.
 */
export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()

  let text: string
  switch (ext) {
    case '.txt':
    case '.md':
    case '.csv':
      text = buffer.toString('utf-8')
      break
    case '.pdf': {
      // Import the implementation directly — pdf-parse's package entry runs a
      // debug harness when it can't find its test fixture.
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js')
      const result = await pdfParse(buffer)
      text = result.text
      break
    }
    case '.docx': {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
      break
    }
    default:
      throw new Error(`Unsupported file type: ${ext || filename}`)
  }

  if (!text || text.trim().length === 0) {
    throw new Error('No text content could be extracted from the file (is it a scanned image?)')
  }
  return text
}
```

If TS complains about the deep import's types, add `declare module 'pdf-parse/lib/pdf-parse.js'` re-exporting `typeof import('pdf-parse')`'s default in a `src/pdf-parse.d.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/scraper && bun test`
Expected: PASS (4 tests).

- [ ] **Step 6: Branch `main()` in `apps/scraper/src/index.ts`**

1. Add imports: `import { getStorage } from 'firebase-admin/storage'` and `import { extractText } from './extract'`.
2. In `initFirebase()`, add to `options`: `storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app``.
3. In `main()`, replace the env validation and the crawl/chunk section (from `const url = process.env.URL` through the `if (allChunks.length === 0)` check) with:

```ts
  const docType = process.env.DOC_TYPE ?? 'webpage'
  const url = process.env.URL
  const storagePath = process.env.STORAGE_PATH

  if (!workspaceId || !docId) {
    console.error('Missing required env vars: WORKSPACE_ID, DOC_ID')
    process.exit(1)
  }
  if (docType === 'webpage' && !url) {
    console.error('DOC_TYPE=webpage requires URL')
    process.exit(1)
  }
  if (docType === 'file' && !storagePath) {
    console.error('DOC_TYPE=file requires STORAGE_PATH')
    process.exit(1)
  }
```

and, inside the `try` after the `processing` status update:

```ts
    const allChunks: string[] = []
    let source: string

    if (docType === 'file') {
      source = storagePath!.split('/').pop()!
      console.log(`[ingestor] Downloading ${storagePath}`)
      const [buffer] = await getStorage().bucket().file(storagePath!).download()
      const text = await extractText(source, buffer)
      allChunks.push(...chunkText(text))
      console.log(`[ingestor] ${source}: ${allChunks.length} chunks`)
    } else {
      source = url!
      const pages = await crawl(url!)
      console.log(`[ingestor] Crawled ${pages.size} pages`)
      for (const [pageUrl, text] of pages) {
        const chunks = chunkText(text)
        console.log(`[ingestor] ${pageUrl}: ${chunks.length} chunks`)
        allChunks.push(...chunks)
      }
    }

    if (allChunks.length === 0) {
      throw new Error('No text content found')
    }
```

4. In the `upsertVectors(...)` call, pass `source` instead of `url` as the source argument.

- [ ] **Step 7: Typecheck and build**

Run: `pnpm --filter scraper typecheck && pnpm --filter scraper build`
Expected: PASS. Same test-file exclusion note as Task 5 if `bun:test` types trip `tsc`.

Update `apps/scraper/.env.example` with the three new vars (`DOC_TYPE=webpage|file`, `STORAGE_PATH=`, `FIREBASE_STORAGE_BUCKET=`).

- [ ] **Step 8: End-to-end local check (if env configured)**

With `apps/api` running and a real workspace token:

```bash
curl -s -X POST http://localhost:3001/knowledge/upload \
  -H "Authorization: Bearer <firebase-id-token>" \
  -F "file=@/tmp/sample.md"
```

Expected: `201 {"docId":"...","status":"pending"}`; within ~30s the Firestore doc flips to `indexed` with a nonzero `chunkCount`. (Local trigger spawns the scraper with Bun — it runs the TS entry directly.)

- [ ] **Step 9: Commit**

```bash
git add apps/scraper apps/api/.env.example
git commit -m "feat(ingestor): index uploaded files (pdf/docx/txt/csv/md) from Storage"
```

---

### Task 9: Web — upload UI (knowledge page + onboarding)

**Files:**
- Modify: `apps/web/src/lib/api.ts` (FormData support)
- Create: `apps/web/src/components/knowledge/KnowledgeUpload.tsx`
- Modify: `apps/web/src/app/dashboard/knowledge/page.tsx`
- Modify: `apps/web/src/components/onboarding/StepKnowledge.tsx`

**Interfaces:**
- Consumes: `POST /knowledge/upload` from Task 7; `validateKnowledgeFile`, `KNOWLEDGE_FILE_EXTENSIONS` from Task 1.
- Produces: `<KnowledgeUpload onUploaded={(doc: { docId: string; source: string }) => void} />` client component.

_No unit test — thin UI over already-tested validation; covered by Task 11 E2E._

- [ ] **Step 1: Let `apiRequest` send FormData**

In `apps/web/src/lib/api.ts`, replace the `return fetch(...)` block so JSON headers are only set for non-FormData bodies:

```ts
  const isFormData = init.body instanceof FormData
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${idToken}`,
      ...(init.headers ?? {}),
    },
  })
```

- [ ] **Step 2: Create `apps/web/src/components/knowledge/KnowledgeUpload.tsx`**

Follow the existing inline-style conventions (see `knowledge/page.tsx`):

```tsx
'use client'

import { useRef, useState } from 'react'
import { FileUp, Loader2, AlertCircle } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { validateKnowledgeFile, KNOWLEDGE_FILE_EXTENSIONS } from '@ayooda/shared'

export function KnowledgeUpload({
  onUploaded,
}: {
  onUploaded: (doc: { docId: string; source: string }) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    const validation = validateKnowledgeFile(file.name, file.size)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiRequest('/knowledge/upload', { method: 'POST', body: form })
      const data = (await res.json()) as { docId?: string; error?: string }
      if (!res.ok || !data.docId) throw new Error(data.error ?? 'Upload failed')
      onUploaded({ docId: data.docId, source: file.name })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={KNOWLEDGE_FILE_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn btn-ghost"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center',
          padding: '12px 16px', borderRadius: 'var(--r-sm)', border: '1px dashed var(--line-2)',
          cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
          fontSize: 13, color: 'var(--ink-mute)', background: 'transparent',
        }}
      >
        {uploading
          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          : <FileUp size={14} />}
        {uploading ? 'Uploading…' : 'Upload a document (PDF, DOCX, TXT, CSV, MD — max 10 MB)'}
      </button>
      {error && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f87171', marginTop: 8 }}>
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Integrate into the knowledge page**

In `apps/web/src/app/dashboard/knowledge/page.tsx`:
1. `import { KnowledgeUpload } from '@/components/knowledge/KnowledgeUpload'`
2. Inside the "Add URL" card, after the crawl-hint `<p>` (the one ending "up to 25 pages)."), add:

```tsx
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <KnowledgeUpload onUploaded={() => void fetchDocs()} />
        </div>
```

3. Update the page subtitle from "Pages your agent can reference…" to "Pages and documents your agent can reference when answering questions." and, in the doc list rows, render a file icon for `type === 'file'` docs: import `FileText` from lucide and, at the start of each row, add `{doc.type === 'file' ? <FileText size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} /> : <Globe size={14} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />}`.

- [ ] **Step 4: Integrate into onboarding**

In `apps/web/src/components/onboarding/StepKnowledge.tsx`:
1. Import `KnowledgeUpload`.
2. After the closing `</div>` of the URL-input block (before the queued-URLs list), add:

```tsx
        <KnowledgeUpload
          onUploaded={(doc) =>
            setQueued((prev) => [...prev, { docId: doc.docId, url: doc.source, status: 'pending' }])
          }
        />
```

3. Update the step copy: subtitle → "Enter your website URL or upload documents. We'll index the content so your agent can answer questions about it."

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): knowledge-base file uploads in dashboard and onboarding"
```

---

### Task 10: Dashboard overview — real metrics

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` (full rewrite as async server component)
- Modify: `firestore.indexes.json` (composite index for automation-rate count)

**Interfaces:**
- Consumes: counters from Task 2 (`usage.messageCount`, `usage.conversationCount`, `usage.tokenCount`, `hadTakeover`); `getAdminAuth`/`getAdminDb` from `apps/web/src/lib/firebase-admin.ts` (existing, same as `dashboard/layout.tsx`).
- Produces: the user-visible overview page.

**Before coding:** skim `apps/web/node_modules/next/dist/docs/` for server-component data-fetching conventions (Next 16 — `cookies()` is async).

- [ ] **Step 1: Add the composite index**

In `firestore.indexes.json`, add to the `indexes` array:

```json
{
  "collectionGroup": "conversations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "hadTakeover", "order": "ASCENDING" }
  ]
}
```

(Deploy later with `firebase deploy --only firestore:indexes` — note this in the final report; not run automatically.)

- [ ] **Step 2: Rewrite `apps/web/src/app/dashboard/page.tsx`**

Replace the whole file. Keep the existing visual card markup (stats grid + Get-started card) but make it an async server component fed by real data:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare, BookOpen, Bot, Zap } from 'lucide-react'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { GetStartedStep } from '@/components/dashboard/GetStartedStep'

export const dynamic = 'force-dynamic'

async function loadOverview() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')?.value
  if (!sessionCookie) redirect('/login')

  const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
  const db = getAdminDb()
  const userSnap = await db.doc(`users/${decoded.uid}`).get()
  const { workspaceId } = userSnap.data()!
  const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()
  const workspace = workspaceSnap.data()!

  const convCol = db.collection(`workspaces/${workspaceId}/conversations`)
  const knowledgeCol = db.collection(`workspaces/${workspaceId}/knowledge`)
  const channelsCol = db.collection(`workspaces/${workspaceId}/channels`)

  const [totalConvAgg, resolvedAgg, resolvedTakeoverAgg, knowledgeSnap, channelsAgg, recentSnap] =
    await Promise.all([
      convCol.count().get(),
      convCol.where('status', '==', 'resolved').count().get(),
      convCol.where('status', '==', 'resolved').where('hadTakeover', '==', true).count().get(),
      knowledgeCol.get(),
      channelsCol.count().get(),
      convCol.orderBy('updatedAt', 'desc').limit(5).get(),
    ])

  const totalConversations = totalConvAgg.data().count
  const resolved = resolvedAgg.data().count
  const resolvedWithTakeover = resolvedTakeoverAgg.data().count
  const knowledgeDocs = knowledgeSnap.docs.map((d) => d.data())
  const indexedDocs = knowledgeDocs.filter((d) => d.status === 'indexed')
  const chunkCount = indexedDocs.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0)
  const channelCount = channelsAgg.data().count
  const usage = workspace.usage ?? { conversationCount: 0, messageCount: 0, tokenCount: 0 }

  return {
    totalConversations,
    automationRate: resolved > 0 ? Math.round(((resolved - resolvedWithTakeover) / resolved) * 100) : null,
    avgMessages:
      usage.conversationCount > 0 ? (usage.messageCount ?? 0) / usage.conversationCount : null,
    knowledgeDocCount: knowledgeDocs.length,
    indexedDocCount: indexedDocs.length,
    chunkCount,
    channelCount,
    agentConfigured: Boolean(workspace.agent?.description),
    recent: recentSnap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        lastMessage: (data.lastMessage as string) ?? '',
        status: data.status as string,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      }
    }),
  }
}

export default async function DashboardPage() {
  const o = await loadOverview()

  const stats = [
    {
      label: 'Total conversations',
      value: String(o.totalConversations),
      sub: o.avgMessages !== null ? `${o.avgMessages.toFixed(1)} messages avg` : undefined,
      icon: MessageSquare,
      accent: 'var(--blue)',
    },
    {
      label: 'Automation rate',
      value: o.automationRate !== null ? `${o.automationRate}%` : '—',
      sub: o.automationRate !== null ? 'resolved without takeover' : 'no resolved conversations yet',
      icon: Zap,
      accent: 'var(--mint)',
    },
    {
      label: 'Knowledge docs',
      value: String(o.indexedDocCount),
      sub: `${o.chunkCount} chunks indexed`,
      icon: BookOpen,
      accent: 'var(--accent)',
    },
    {
      label: 'Agent status',
      value: o.channelCount > 0 && o.indexedDocCount > 0 ? 'Active' : 'Setup incomplete',
      icon: Bot,
      accent: o.channelCount > 0 && o.indexedDocCount > 0 ? 'var(--mint)' : 'var(--ink-mute)',
    },
  ]

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>Overview</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-mute)', marginTop: 4 }}>
          Your support agent at a glance
        </p>
      </div>

      {/* Stats grid — same card styling as before */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in oklab, ${stat.accent} 15%, transparent)`, border: `1px solid color-mix(in oklab, ${stat.accent} 25%, transparent)`, display: 'grid', placeItems: 'center', marginBottom: 12, color: stat.accent }}>
              <stat.icon size={16} />
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)' }}>{stat.value}</p>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>{stat.label}</p>
            {stat.sub && <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{stat.sub}</p>}
          </div>
        ))}
      </div>

      {/* Recent conversations */}
      {o.recent.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
            Recent conversations
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {o.recent.map((conv, i) => (
              <Link key={conv.id} href="/dashboard/inbox" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', textDecoration: 'none' }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.lastMessage || 'New conversation'}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)', flexShrink: 0 }}>{conv.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Get started */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
          Get started
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GetStartedStep number={1} title="Configure your agent" description="Give your agent a name, avatar, and personality." href="/dashboard/agent" done={o.agentConfigured} />
          <GetStartedStep number={2} title="Add your knowledge base" description="Paste your website URL or upload documents." href="/dashboard/knowledge" done={o.indexedDocCount > 0} />
          <GetStartedStep number={3} title="Deploy the widget" description="Copy a script tag and paste it into your website." href="/dashboard/channels" done={o.channelCount > 0} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: all PASS. If the two-equality count query errors at runtime with a FAILED_PRECONDITION mentioning an index, the Step 1 index needs deploying — for local verification against prod Firestore, deploy it first.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx firestore.indexes.json
git commit -m "feat(web): real dashboard metrics, recent activity, live get-started checklist"
```

---

### Task 11: Full verification pass + docs

**Files:**
- Modify: `docs/architecture.md` (API surface additions)

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm -r build`
Expected: all packages pass. Fix anything that fails before proceeding.

- [ ] **Step 2: Manual E2E — requires local env (`apps/api/.env`, `apps/web/.env.local`) or a deploy**

Use the superpowers:verification-before-completion skill. Start `pnpm --filter api dev` and `pnpm --filter web dev`, build the widget and serve a test page embedding `apps/widget/dist/widget.js` with `data-agent-id` + `data-api-url="http://localhost:3001"` (e.g. `python3 -m http.server` in a scratch dir with an `index.html`). Then verify each flow with the browser tools (Chrome DevTools MCP or Playwright MCP):

1. **Streaming:** send a widget message → reply renders incrementally (multiple paints, not one). `usage.messageCount` +2 and `usage.tokenCount` grew (check Firestore).
2. **Takeover:** in the dashboard inbox, take over the conversation → widget shows "You're now chatting with a human"; operator reply appears in the widget without a page reload; resolve → resolved note. `hadTakeover: true` on the conversation doc.
3. **File upload:** upload a real PDF and a `.md` file on the knowledge page → both reach `indexed` with chunk counts; ask the widget a question only answerable from the file → grounded answer. Delete the file doc → Storage object and Pinecone vectors gone (spot-check Storage). Reject case: upload a `.exe` → inline error, no doc created.
4. **Onboarding:** run through `/onboarding` with a file upload in step 2.
5. **Dashboard:** overview shows real counts matching Firestore; checklist items show done-states; automation rate appears after resolving a conversation without takeover.
6. **Regression:** add a URL source → still crawls and indexes; inbox real-time updates still work.

Record what was actually verified vs. skipped (and why) in the final report — no unverified success claims.

- [ ] **Step 3: Update `docs/architecture.md`**

In the API-surface section: add `POST /knowledge/upload` under protected routes; add `GET /widget/conversations/:id/events (SSE)` under public routes; note `POST /widget/chat` now streams SSE. In the env-vars section, add `FIREBASE_STORAGE_BUCKET` (api + scraper) and `DOC_TYPE`/`STORAGE_PATH` (scraper job overrides).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: architecture updates for SSE, uploads, and metrics"
```

- [ ] **Step 5: Deployment follow-ups (report, do not run):** `firebase deploy --only firestore:indexes` for the new composite index; API/scraper redeploy picks up new routes; widget redeploy (`firebase deploy --only hosting:widget`) ships the new bundle; Cloud Run request timeout ≥ 300s is fine for SSE (widget reconnects).
