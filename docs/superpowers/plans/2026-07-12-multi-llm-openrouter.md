# Ayooda Multi-Model via OpenRouter + BYO Key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-12-multi-llm-byo-keys-design.md`: route all chat through OpenRouter, let a workspace pick any catalog model, run non-Gemini models on the customer's encrypted OpenRouter key with a Gemini-only platform fallback.

**Architecture:** A provider-aware model catalog in `@ayooda/shared`; an AES-256-GCM crypto helper; a single `fetch`-based OpenRouter streaming client (no SDK); a key-resolution helper; encrypted per-workspace key storage with new endpoints; and the widget chat handler swapped from direct Gemini to the OpenRouter client. Embeddings stay on direct Gemini.

**Tech Stack:** Hono 4 on Bun, Node `crypto`, `fetch` SSE, firebase-admin 12, Next.js 16, `bun test`. **No new npm dependencies.**

## Global Constraints

- **OpenRouter only** for chat — one `fetch`-based client, no `@anthropic-ai/sdk`/`openai`/Gemini-chat SDK. No new npm deps.
- **Embeddings unchanged** — `apps/api/src/lib/gemini.ts` keeps `gemini-embedding-001` via `GEMINI_API_KEY`. Do not route embeddings through OpenRouter.
- **One key per workspace**: `workspaces/{id}.openRouterKey` (AES-256-GCM encrypted). Never returned by any endpoint — `GET /workspace` exposes only `hasOpenRouterKey: boolean`.
- **Fallback policy**: customer key → all models; else platform `OPENROUTER_API_KEY` for **gemini-provider models only**; else `missing_key`.
- `API_KEY_ENCRYPTION_SECRET` env is required for the crypto module; the module throws on first use if it's missing. Document it in `apps/api/.env.example`.
- `apps/web` is **Next.js 16** — consult `apps/web/node_modules/next/dist/docs/` if an App Router API question arises (this work is client components).
- Model slugs are **OpenRouter slugs** (`vendor/model`); pin exact current slugs in Task 1 from openrouter.ai/models — do not invent. `@ayooda/shared` builds to `dist/`; run `pnpm --filter @ayooda/shared build` after editing it.
- Run `corepack enable` if `pnpm` is missing. Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Provider-aware model catalog (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LLMModel` interface; `LLM_MODELS: readonly LLMModel[]`; `GEMINI_MODELS` (derived, back-compat); `findModel(id): LLMModel | undefined`; `providerOf(id): LLMProvider | undefined`. Tasks 4–6 import these.

- [ ] **Step 1: Pin current OpenRouter slugs**

Before coding, fetch openrouter.ai/models (WebFetch) and pick two models per provider — a fast/cheap and a stronger option. Record the exact slugs. Expected shape (verify slugs; these are illustrative and MUST be confirmed): `google/gemini-2.5-flash`, `google/gemini-2.5-pro`, `anthropic/claude-3.5-haiku`, `anthropic/claude-sonnet-4`, `openai/gpt-4o-mini`, `openai/gpt-4o`. Use the confirmed slugs in Step 3.

- [ ] **Step 2: Write the failing test**

In `packages/shared/src/index.test.ts`, add (keep the existing `validateKnowledgeFile` describe block):

```ts
import { LLM_MODELS, GEMINI_MODELS, findModel, providerOf } from './index'

describe('LLM catalog', () => {
  test('every model has a unique slug and a valid provider', () => {
    const seen = new Set<string>()
    for (const m of LLM_MODELS) {
      expect(['gemini', 'claude', 'openai']).toContain(m.provider)
      expect(m.id).toContain('/') // OpenRouter slugs are vendor/model
      expect(seen.has(m.id)).toBe(false)
      seen.add(m.id)
    }
    expect(LLM_MODELS.length).toBeGreaterThanOrEqual(6)
  })
  test('GEMINI_MODELS is the gemini subset', () => {
    expect(GEMINI_MODELS.length).toBeGreaterThan(0)
    expect(GEMINI_MODELS.every((m) => m.provider === 'gemini')).toBe(true)
  })
  test('findModel and providerOf resolve a known slug', () => {
    const first = LLM_MODELS[0]
    expect(findModel(first.id)).toEqual(first)
    expect(providerOf(first.id)).toBe(first.provider)
  })
  test('providerOf returns undefined for an unknown slug', () => {
    expect(providerOf('nope/nope')).toBeUndefined()
    expect(findModel('nope/nope')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Implement in `packages/shared/src/index.ts`**

Find the existing `GEMINI_MODELS` / `GeminiModelId` block (near the top). Replace it with the catalog (use the confirmed slugs from Step 1):

```ts
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string // OpenRouter slug, e.g. "anthropic/claude-3.5-haiku"
  label: string
  description: string
}

export const LLM_MODELS: readonly LLMModel[] = [
  { provider: 'gemini', id: 'google/gemini-2.5-flash', label: 'Gemini Flash', description: 'Fast · Best for most cases' },
  { provider: 'gemini', id: 'google/gemini-2.5-pro', label: 'Gemini Pro', description: 'Smarter · Complex topics' },
  { provider: 'claude', id: 'anthropic/claude-3.5-haiku', label: 'Claude Haiku', description: 'Fast · Cost-effective' },
  { provider: 'claude', id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet', description: 'Strong reasoning' },
  { provider: 'openai', id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast · Cost-effective' },
  { provider: 'openai', id: 'openai/gpt-4o', label: 'GPT-4o', description: 'Capable general model' },
] as const

/** Back-compat: the agent page and PUT validation still import GEMINI_MODELS. */
export const GEMINI_MODELS = LLM_MODELS.filter((m) => m.provider === 'gemini')

export function findModel(id: string): LLMModel | undefined {
  return LLM_MODELS.find((m) => m.id === id)
}

export function providerOf(id: string): LLMProvider | undefined {
  return findModel(id)?.provider
}
```

Then remove the now-obsolete `GeminiModelId` type export and fix its usages: `grep -rn "GeminiModelId" packages apps`. Replace `GeminiModelId` with `string` in signatures (`AgentConfig.llmModel: string`, and the `PUT /workspace/agent` body type + `agent/page.tsx` state — those are updated in later tasks, but make the type compile now by widening to `string`). If `AgentConfig.llmModel` was `GeminiModelId`, change it to `string`.

- [ ] **Step 4: Run tests + build + typecheck dependents**

Run: `cd packages/shared && bun test`
Expected: PASS (existing + 4 new).
Run: `pnpm --filter @ayooda/shared build && pnpm -r typecheck`
Expected: PASS. If `apps/web/agent/page.tsx` or `apps/api/routes/workspace.ts` break on `GeminiModelId`, widen those references to `string` (they get their real treatment in Tasks 4/6, but must compile now).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): provider-aware LLM catalog with OpenRouter slugs"
```

---

### Task 2: AES-256-GCM crypto helper

**Files:**
- Create: `apps/api/src/lib/crypto.ts`
- Create: `apps/api/src/lib/crypto.test.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `process.env.API_KEY_ENCRYPTION_SECRET`.
- Produces: `encryptSecret(plaintext: string): string`; `decryptSecret(payload: string): string`. Tasks 4–5 use them.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/crypto.test.ts`:

```ts
import { describe, expect, test, beforeAll } from 'bun:test'

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret-please-change'
})

describe('crypto', () => {
  test('round-trips a secret', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const plain = 'sk-or-v1-abc123'
    const enc = encryptSecret(plain)
    expect(enc).not.toContain(plain)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(plain)
  })
  test('different ciphertext each call (random IV)', async () => {
    const { encryptSecret } = await import('./crypto')
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })
  test('rejects a tampered payload', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const enc = encryptSecret('secret')
    const parts = enc.split(':')
    // Flip a character in the ciphertext segment
    parts[3] = parts[3].slice(0, -1) + (parts[3].slice(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/crypto.test.ts`
Expected: FAIL — cannot resolve `./crypto`.

- [ ] **Step 3: Implement `apps/api/src/lib/crypto.ts`**

```ts
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/** 32-byte key derived from the configured secret (any length in, 32 bytes out). */
function key(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('API_KEY_ENCRYPTION_SECRET is not set')
  return createHash('sha256').update(secret).digest()
}

/** Encrypt to "v1:<iv b64>:<authTag b64>:<ciphertext b64>". */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/** Decrypt a "v1:..." payload. Throws on tamper, wrong key, or malformed input. */
export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted payload')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/crypto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the env var + commit**

In `apps/api/.env.example`, add: `API_KEY_ENCRYPTION_SECRET= # 32+ random chars; encrypts customer OpenRouter keys at rest` and `OPENROUTER_API_KEY= # platform key; Gemini-family fallback when a workspace has no key`.

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/crypto.ts apps/api/src/lib/crypto.test.ts apps/api/.env.example
git commit -m "feat(api): AES-256-GCM secret encryption helper"
```

---

### Task 3: OpenRouter streaming chat client

**Files:**
- Create: `apps/api/src/lib/llm/openrouter.ts`
- Create: `apps/api/src/lib/llm/openrouter.test.ts`

**Interfaces:**
- Consumes: `fetch` (global).
- Produces: types `ChatMessage`, `ChatParams`, `ChatChunk`, `ChatResult`; `streamChat(params: ChatParams): AsyncGenerator<ChatChunk, ChatResult, void>`. Task 5 drives the SSE loop from this.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/llm/openrouter.test.ts` (mocks `fetch` with a canned OpenAI-style SSE body):

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { streamChat } from './openrouter'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('streamChat', () => {
  test('forwards deltas in order, stops on [DONE], reports usage', async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n'
    globalThis.fetch = (async () => sseResponse(body)) as typeof fetch

    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
    const chunks: string[] = []
    let result
    while (true) {
      const next = await gen.next()
      if (next.done) { result = next.value; break }
      chunks.push(next.value.text)
    }
    expect(chunks).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ promptTokens: 11, completionTokens: 2 })
  })

  test('throws on a non-2xx response', async () => {
    globalThis.fetch = (async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })) as typeof fetch
    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [], apiKey: 'k' })
    await expect(gen.next()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/llm/openrouter.test.ts`
Expected: FAIL — cannot resolve `./openrouter`.

- [ ] **Step 3: Implement `apps/api/src/lib/llm/openrouter.ts`**

```ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; systemPrompt: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Stream a chat completion from OpenRouter (OpenAI-compatible SSE).
 * Yields text deltas; returns token usage after the stream completes.
 */
export async function* streamChat(
  params: ChatParams,
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ayooda.live',
      'X-Title': 'Ayooda',
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
      stream: true,
      stream_options: { include_usage: true },
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let promptTokens = 0
  let completionTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        try { parsed = JSON.parse(data) } catch { continue }
        const text = parsed.choices?.[0]?.delta?.content
        if (text) yield { text }
        if (parsed.usage) {
          promptTokens = parsed.usage.prompt_tokens ?? promptTokens
          completionTokens = parsed.usage.completion_tokens ?? completionTokens
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return { promptTokens, completionTokens }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/llm/openrouter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/llm/openrouter.ts apps/api/src/lib/llm/openrouter.test.ts
git commit -m "feat(api): OpenRouter streaming chat client"
```

---

### Task 4: Key resolution + key endpoints + workspace status

**Files:**
- Create: `apps/api/src/lib/llm/resolve.ts`
- Create: `apps/api/src/lib/llm/resolve.test.ts`
- Modify: `apps/api/src/routes/workspace.ts`
- Modify: `packages/shared/src/index.ts` (WorkspaceDoc field)
- Modify: `apps/api/src/lib/gemini.ts` (extend LEGACY_MODEL_MAP)

**Interfaces:**
- Consumes: `decryptSecret` (Task 2), `encryptSecret`, `providerOf`/`LLM_MODELS` (Task 1).
- Produces: `resolveOpenRouterKey(provider, encryptedWorkspaceKey): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' }`; `PUT /workspace/key`, `DELETE /workspace/key`; `GET /workspace` returns `hasOpenRouterKey`. Task 5 calls `resolveOpenRouterKey`.

- [ ] **Step 1: Write the failing resolve test**

Create `apps/api/src/lib/llm/resolve.test.ts`:

```ts
import { describe, expect, test, beforeAll } from 'bun:test'

beforeAll(() => { process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret' })

describe('resolveOpenRouterKey', () => {
  test('uses the decrypted workspace key when present', async () => {
    const { encryptSecret } = await import('../crypto')
    const { resolveOpenRouterKey } = await import('./resolve')
    const enc = encryptSecret('sk-or-customer')
    expect(resolveOpenRouterKey('claude', enc)).toEqual({ ok: true, apiKey: 'sk-or-customer' })
  })
  test('falls back to platform key for gemini only', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-platform'
    const { resolveOpenRouterKey } = await import('./resolve')
    expect(resolveOpenRouterKey('gemini', undefined)).toEqual({ ok: true, apiKey: 'sk-or-platform' })
    expect(resolveOpenRouterKey('claude', undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
  test('missing everything → missing_key', async () => {
    delete process.env.OPENROUTER_API_KEY
    const { resolveOpenRouterKey } = await import('./resolve')
    expect(resolveOpenRouterKey('gemini', undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/llm/resolve.test.ts`
Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 3: Implement `apps/api/src/lib/llm/resolve.ts`**

```ts
import type { LLMProvider } from '@ayooda/shared'
import { decryptSecret } from '../crypto'

export function resolveOpenRouterKey(
  provider: LLMProvider,
  encryptedWorkspaceKey: string | undefined,
): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' } {
  if (encryptedWorkspaceKey) {
    return { ok: true, apiKey: decryptSecret(encryptedWorkspaceKey) }
  }
  if (provider === 'gemini' && process.env.OPENROUTER_API_KEY) {
    return { ok: true, apiKey: process.env.OPENROUTER_API_KEY }
  }
  return { ok: false, reason: 'missing_key' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/llm/resolve.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend `WorkspaceDoc` + LEGACY_MODEL_MAP**

In `packages/shared/src/index.ts`, add to `WorkspaceDoc`: `openRouterKey?: string // encrypted; server-only, never returned`.

In `apps/api/src/lib/gemini.ts`, replace the `LEGACY_MODEL_MAP` entries so retired/bare Gemini ids map to OpenRouter slugs (use the Task 1 confirmed slugs):

```ts
export const LEGACY_MODEL_MAP: Record<string, string> = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini-flash-latest': 'google/gemini-2.5-flash',
  'gemini-pro-latest': 'google/gemini-2.5-pro',
}
```

Run: `pnpm --filter @ayooda/shared build`.

- [ ] **Step 6: Add key endpoints + hasOpenRouterKey to `apps/api/src/routes/workspace.ts`**

Add imports at the top:

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { encryptSecret } from '../lib/crypto'
import { LLM_MODELS } from '@ayooda/shared'
```

In `GET /workspace`, add `hasOpenRouterKey: Boolean(data.openRouterKey)` to the returned object (and keep never returning `openRouterKey` itself).

Broaden `PUT /workspace/agent` validation from `GEMINI_MODELS` to `LLM_MODELS`: change the guard to `if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel))`. (Import `LLM_MODELS`; you may drop the `GEMINI_MODELS` import if now unused.)

Add the two key endpoints after `PUT /agent`:

```ts
/** PUT /workspace/key — store the workspace's OpenRouter API key (encrypted) */
workspace.put('/key', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ apiKey?: string }>()
  const apiKey = body.apiKey?.trim()
  if (!apiKey || apiKey.length > 500) {
    return c.json({ error: 'apiKey is required (max 500 chars)' }, 400)
  }
  await adminDb.doc(`workspaces/${workspaceId}`).update({ openRouterKey: encryptSecret(apiKey) })
  return c.json({ ok: true })
})

/** DELETE /workspace/key — remove the stored key */
workspace.delete('/key', async (c) => {
  const workspaceId = c.get('workspaceId')
  await adminDb.doc(`workspaces/${workspaceId}`).update({ openRouterKey: FieldValue.delete() })
  return c.json({ ok: true })
})
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter api typecheck && pnpm -r typecheck`
Expected: PASS.
```bash
git add apps/api/src/lib/llm/resolve.ts apps/api/src/lib/llm/resolve.test.ts apps/api/src/routes/workspace.ts apps/api/src/lib/gemini.ts packages/shared
git commit -m "feat(api): OpenRouter key storage, resolution, and workspace status"
```

---

### Task 5: Swap widget chat to OpenRouter

**Files:**
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `streamChat` (Task 3), `resolveOpenRouterKey` (Task 4), `providerOf` + `LEGACY_MODEL_MAP` (Tasks 1/4).
- Produces: `POST /widget/chat` streams via OpenRouter; pre-stream JSON 502 when a non-Gemini model has no key.

_No unit test — integration handler; verified in Task 7 E2E on the Gemini path._

- [ ] **Step 1: Add imports + resolve provider/key before streaming**

In `apps/api/src/routes/widget.ts`, add imports:

```ts
import { providerOf } from '@ayooda/shared'
import { streamChat } from '../lib/llm/openrouter'
import { resolveOpenRouterKey } from '../lib/llm/resolve'
```

The handler already computes `llmModel` (via `LEGACY_MODEL_MAP[storedModel] ?? storedModel`). After that line and after `workspaceData` is available, add — but before the RAG/prompt building is fine; place it right before "6. Build prompt":

```ts
  // Resolve provider + key before any streaming (pre-stream errors stay JSON)
  const provider = providerOf(llmModel) ?? 'gemini'
  const keyResult = resolveOpenRouterKey(provider, workspaceData.openRouterKey)
  if (!keyResult.ok) {
    return c.json(
      { error: "This agent's AI model needs an OpenRouter API key. Add one in Settings." },
      502,
    )
  }
```

Note: `llmModel` is already mapped through `LEGACY_MODEL_MAP`, so it is an OpenRouter slug here; `providerOf` resolves it.

- [ ] **Step 2: Replace the Gemini streaming block with OpenRouter**

Replace the body of the `streamSSE(c, async (stream) => { ... })` callback's `try` — specifically the Gemini construction and the `for await` loop (currently building `genAI`/`model`/`generateContentStream` and iterating `result.stream`) — with the OpenRouter generator. Keep everything else in the callback identical (the `generation`, `reply` accumulation, `messageRef` save, `done` event, bookkeeping, and the `catch`). The replacement for the top of the `try`:

```ts
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
```

Then the existing lines from `// 8. Save assistant message` onward stay exactly as they are (they reference `reply`, `promptTokens`, `completionTokens`, `sources`, `llmModel`, `messagesRef`, `convRef`, `workspaceRef`). Remove the now-unused `GoogleGenerativeAI` import from `widget.ts` if nothing else uses it (grep first — the embeddings path uses `embedText`, not this import, so it is likely removable). Rename the Langfuse `generation` name from `'gemini-chat'` to `'llm-chat'` and the `contents` variable is gone (deleted with the old block). Update the outer `catch`'s `console.error` label and `trace.update({ output: { error: 'gemini_failed' } })` to a provider-neutral `'llm_failed'`.

Also delete the now-dead `contents` construction that preceded the old step 7 (the `const contents = history.slice(0, -1).map(...)` Gemini-shaped array and its `contents.push(...)`), since `chatMessages` replaces it.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. Grep to confirm no stray `GoogleGenerativeAI`/`generateContentStream`/`contents` references remain in the chat handler: `grep -n "GoogleGenerativeAI\|generateContentStream\|contents" apps/api/src/routes/widget.ts` (embedding-related hits elsewhere are fine; the chat handler should be clean).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/widget.ts
git commit -m "feat(api): route widget chat through OpenRouter with key resolution"
```

---

### Task 6: Web — provider-grouped model picker + API key card

**Files:**
- Modify: `apps/web/src/app/dashboard/agent/page.tsx`
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`
- Modify: `apps/web/src/hooks/useWorkspace.ts`

**Interfaces:**
- Consumes: `LLM_MODELS`, `providerOf` (Task 1); `PUT /workspace/key`, `DELETE /workspace/key`, `hasOpenRouterKey` (Task 4).
- Produces: provider-grouped model selection; an OpenRouter key card in Settings.

_No unit test — UI; verified in Task 7 E2E._

- [ ] **Step 1: Surface `hasOpenRouterKey` in the workspace hook**

In `apps/web/src/hooks/useWorkspace.ts`, add `hasOpenRouterKey?: boolean` to the `WorkspaceData` interface (the API now returns it; optional keeps back-compat).

- [ ] **Step 2: Provider-grouped model picker on the agent page**

In `apps/web/src/app/dashboard/agent/page.tsx`:
1. Change the import from `GEMINI_MODELS, type GeminiModelId` to `LLM_MODELS, providerOf, type LLMProvider`. Change the model state type from `GeminiModelId` to `string`: `const [llmModel, setLlmModel] = useState<string>(LLM_MODELS[0].id)`.
2. Replace the "AI model" section's `GEMINI_MODELS.map(...)` grid with provider-grouped groups. Replace that whole `<div>` block (the one titled "AI model") with:

```tsx
        {/* Model */}
        <div>
          <p style={labelStyle}>AI model</p>
          {(['gemini', 'claude', 'openai'] as LLMProvider[]).map((prov) => (
            <div key={prov} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: 'var(--ink-mute)', textTransform: 'capitalize', margin: '0 0 6px' }}>{prov}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {LLM_MODELS.filter((m) => m.provider === prov).map((m) => (
                  <button
                    key={m.id} type="button" onClick={() => setLlmModel(m.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      padding: '12px 14px', borderRadius: 'var(--r-sm)', textAlign: 'left',
                      cursor: 'pointer', transition: 'all .15s',
                      border: `1px solid ${llmModel === m.id ? 'var(--accent)' : 'var(--line)'}`,
                      background: llmModel === m.id ? 'var(--accent-soft)' : 'var(--bg-2)',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{m.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {providerOf(llmModel) !== 'gemini' && workspace && !workspace.hasOpenRouterKey && (
            <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
              This model needs an OpenRouter key. <a href="/dashboard/settings" style={{ color: 'var(--accent)' }}>Add one in Settings →</a>
            </p>
          )}
        </div>
```

(The `workspace` from `useWorkspace()` is already in scope on this page.)

- [ ] **Step 3: OpenRouter key card in Settings**

In `apps/web/src/app/dashboard/settings/page.tsx` (built in the polish-pack plan), add state and a card. Add to the component state:

```tsx
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
```

In `load()`, when reading the `/workspace` response, also set the key flag: change the `wsRes` handling to also `setHasKey(Boolean((w as { hasOpenRouterKey?: boolean }).hasOpenRouterKey))`.

Add handlers:

```tsx
  async function saveKey() {
    if (!keyInput.trim()) return
    setSavingKey(true); setError('')
    try {
      const res = await apiRequest('/workspace/key', { method: 'PUT', body: JSON.stringify({ apiKey: keyInput.trim() }) })
      if (!res.ok) throw new Error('Failed to save key')
      setHasKey(true); setKeyInput('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setSavingKey(false) }
  }

  async function removeKey() {
    setSavingKey(true); setError('')
    try {
      await apiRequest('/workspace/key', { method: 'DELETE' })
      setHasKey(false)
    } finally { setSavingKey(false) }
  }
```

Add a card (place it after the Workspace card, before Widget install):

```tsx
      {/* OpenRouter key */}
      <div style={cardStyle}>
        <p style={labelStyle}>OpenRouter API key</p>
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 12px' }}>
          One key unlocks Claude, GPT, and more. Gemini works without a key on the platform's allowance.
        </p>
        {hasKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--mint)' }}><Check size={14} /> Connected</span>
            <button type="button" onClick={() => void removeKey()} disabled={savingKey} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, color: '#f87171' }}>Remove</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-or-..." style={{ ...inputStyle, flex: 1 }} />
            <button type="button" onClick={() => void saveKey()} disabled={savingKey || !keyInput.trim()} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: savingKey || !keyInput.trim() ? 0.5 : 1 }}>
              {savingKey ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: typecheck + build PASS; lint shows only the pre-existing failures (none in the two edited files).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): provider-grouped model picker + OpenRouter key settings"
```

---

### Task 7: Verification pass + docs

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm --filter web build`
Expected: all pass (shared catalog, crypto, openrouter, resolve tests included).

- [ ] **Step 2: Live E2E (Gemini path; needs `apps/api/.env` with `API_KEY_ENCRYPTION_SECRET` + `OPENROUTER_API_KEY` if available)**

Use superpowers:verification-before-completion. If `OPENROUTER_API_KEY` is set in `apps/api/.env`, verify a real Gemini-family model streams end-to-end through OpenRouter (widget renders tokens). If it is not set, that live check is **deferred** — record it. Regardless:
1. `PUT /workspace/key` with any string → `GET /workspace` shows `hasOpenRouterKey: true` and never returns the key value; `DELETE /workspace/key` → false.
2. Select a Claude/OpenAI model with no key → `POST /widget/chat` returns JSON `502` with the "needs an OpenRouter API key" message; the widget shows its generic error bubble.
3. Agent page shows all three provider groups; picking a non-Gemini model with no key shows the Settings hint.

Record verified vs. deferred (Claude/OpenAI live streaming always deferred until a real key is provided).

- [ ] **Step 3: Update `docs/architecture.md`**

Note: all chat now routes through OpenRouter (embeddings stay direct Gemini); `openRouterKey` (encrypted) on the workspace; new env vars `API_KEY_ENCRYPTION_SECRET` and `OPENROUTER_API_KEY`; endpoints `PUT/DELETE /workspace/key`; the model catalog is provider-aware (Gemini/Claude/OpenAI via OpenRouter slugs).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: architecture updates for OpenRouter multi-model + BYO key"
```
