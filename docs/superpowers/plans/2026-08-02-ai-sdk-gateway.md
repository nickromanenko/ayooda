# AI SDK + AI Gateway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom OpenRouter fetch client + hand-rolled tool loop with the Vercel AI SDK (`ai` v7) `streamText` routed through AI Gateway, letting the SDK own streaming and the multi-step tool loop.

**Architecture:** `runAgentTurn` is rewritten to a single `streamText({ model: createGateway({apiKey})(id), system, messages, tools, stopWhen: stepCountIs(3) })` call — its `AsyncGenerator<ChatChunk, ChatResult>` signature is preserved so widget/Telegram are untouched. Per-agent BYO keys become AI Gateway keys (`agent.gatewayKey`) with a universal platform `AI_GATEWAY_API_KEY` fallback. Embeddings (direct Gemini) and Langfuse are unchanged.

**Tech Stack:** `ai` ^7, `zod` ^4, Bun + Hono (api), Firestore, `@ayooda/shared`, Next.js. Tests: `bun test`.

## Global Constraints

- **`streamText` + `stepCountIs(MAX_ROUNDS=3)`** own the tool loop; `runAgentTurn` keeps its `AsyncGenerator<ChatChunk, ChatResult, void>` signature. Text from `result.textStream`; tokens from `await result.usage` → map `inputTokens→promptTokens`, `outputTokens→completionTokens`.
- **`ChatParams` keeps the field name `systemPrompt`** (mapped to `streamText`'s `system` inside `runAgentTurn`) so `prepareTurn`/widget/Telegram are untouched.
- **Per-agent key field `agent.gatewayKey`** (was `openRouterKey`); shared `AgentDoc.hasOpenRouterKey` → `hasGatewayKey`. Platform fallback `AI_GATEWAY_API_KEY` covers **all** providers (no Gemini-only restriction).
- **`LLM_MODELS` slugs unchanged** (already Gateway model ids). Embeddings + Langfuse spans unchanged.
- **Tool execution stays SSRF-guarded** via the existing `executeTool`; `toAiSdkTools` wraps each in `tool({ inputSchema: z.object(...), execute })`.
- **`OPENROUTER_API_KEY` retired**; the SDK reads `AI_GATEWAY_API_KEY` by default.

---

### Task 1: Add `ai` + `zod` dependencies

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install**

Run: `pnpm --filter api add ai zod`
Expected: `ai` (^7) and `zod` (^4) added to `apps/api/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Baseline still green**

Run: `cd apps/api && pnpm --filter api typecheck && bun test`
Expected: PASS (no code changed yet).

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add ai + zod deps"
```

---

### Task 2: Core rewrite — `chat.ts` types, `toAiSdkTools` + `runAgentTurn`, delete `openrouter.ts`

**Files:**
- Create: `apps/api/src/lib/llm/chat.ts`
- Delete: `apps/api/src/lib/llm/openrouter.ts`, `apps/api/src/lib/llm/openrouter.test.ts`
- Modify: `apps/api/src/lib/chat/tools.ts`
- Modify: `apps/api/src/lib/chat/tools.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (repoint the `ChatParams` import)

**Interfaces:**
- Consumes: `ai` (`streamText`, `createGateway`, `stepCountIs`, `tool`, `ToolSet`), `zod`; existing `executeTool`, `StoredTool`, `ToolResult`, `LangfuseTrace`.
- Produces: `apps/api/src/lib/llm/chat.ts` exporting `ChatMessage`, `ChatParams { model; systemPrompt; messages; apiKey }`, `ChatChunk { text }`, `ChatResult { promptTokens; completionTokens }`. `toAiSdkTools(tools, trace, execute?)`. `runAgentTurn` (same signature).

- [ ] **Step 1: Create `chat.ts` types**

Create `apps/api/src/lib/llm/chat.ts`:

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; systemPrompt: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }
```

- [ ] **Step 2: Rewrite the tools.test.ts blocks that change**

In `apps/api/src/lib/chat/tools.test.ts`:

Change the import on line 2 from `toOpenRouterTools` to `toAiSdkTools`:

```ts
import { toAiSdkTools, buildToolRequest, type StoredTool } from './tools'
```

Replace the entire `describe('toOpenRouterTools', …)` block with:

```ts
describe('toAiSdkTools', () => {
  test('maps to a tool set whose execute returns the formatted executor result', async () => {
    const set = toAiSdkTools([readTool], fakeTrace, async (_t, args) => ({ status: 200, body: JSON.stringify(args) }))
    expect(Object.keys(set)).toEqual(['order_lookup'])
    const out = await set.order_lookup!.execute!({ orderId: 'A1' }, { toolCallId: 't', messages: [] } as never)
    expect(out).toBe('status 200\n{"orderId":"A1"}')
  })
  test('execute surfaces an executor error string', async () => {
    const set = toAiSdkTools([readTool], fakeTrace, async () => ({ status: 0, body: '', error: 'blocked host' }))
    const out = await set.order_lookup!.execute!({ orderId: 'A1' }, { toolCallId: 't', messages: [] } as never)
    expect(out).toBe('error: blocked host')
  })
})
```

Add a `fakeTrace` near the top of the file if not already present (the runAgentTurn block defines one — move it up so both blocks can use it):

```ts
const fakeTrace = { span: () => ({ end: () => {} }) } as unknown as import('../langfuse').LangfuseTrace
```

Replace the `describe('runAgentTurn', …)` block (and its `streamText`/`streamCall` generator helpers) with SDK-shaped fakes:

```ts
import { runAgentTurn } from './tools'

function fakeStream(deltas: string[], usage: { inputTokens?: number; outputTokens?: number }) {
  return { textStream: (async function* () { for (const d of deltas) yield d })(), usage: Promise.resolve(usage) }
}

describe('runAgentTurn', () => {
  test('yields text deltas and maps usage → prompt/completion tokens', async () => {
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' },
      [], fakeTrace,
      { streamText: () => fakeStream(['Hel', 'lo'], { inputTokens: 9, outputTokens: 2 }) },
    )
    const texts: string[] = []
    let result: { promptTokens: number; completionTokens: number } | undefined
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect(texts).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ promptTokens: 9, completionTokens: 2 })
  })
  test('passes no tools when the workspace has none', async () => {
    let seenTools: unknown = 'unset'
    const gen = runAgentTurn(
      { model: 'm', systemPrompt: 's', messages: [], apiKey: 'k' }, [], fakeTrace,
      { streamText: (o) => { seenTools = o.tools; return fakeStream(['x'], {}) } },
    )
    while (!(await gen.next()).done) { /* drain */ }
    expect(seenTools).toBeUndefined()
  })
})
```

Keep the existing `selectExposedTools`, `buildToolRequest`, and `executeTool` describe blocks and their helpers (`readTool`, `mkTool`) unchanged — but delete the now-unused old `streamText`/`streamCall` async-generator helpers and any `import { selectExposedTools, runAgentTurn } from './tools'` duplicate (consolidate imports).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts`
Expected: FAIL — `toAiSdkTools` not exported / `runAgentTurn` new-shape mismatch.

- [ ] **Step 4: Rewrite `tools.ts`**

In `apps/api/src/lib/chat/tools.ts`:

Replace the top imports (line ~2–3) — drop the `openrouter` import, add `ai`/`zod`/`chat.ts`:

```ts
import { lookup as dnsLookup } from 'node:dns/promises'
import { streamText as aiStreamText, createGateway, stepCountIs, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ToolMethod, ToolParam } from '@ayooda/shared'
import type { ChatParams, ChatChunk, ChatResult, ChatMessage } from '../llm/chat'
import { decryptSecret } from '../crypto'
import { isBlockedAddress } from '../tools/ssrf'
import { adminDb } from '../firebase-admin'
import type { LangfuseTrace } from '../langfuse'
```

(`ChatMessage` may be unused after the rewrite — remove it from the import if the final `runAgentTurn` doesn't reference it.)

Replace `toOpenRouterTools` (lines ~23–40) with `toAiSdkTools`:

```ts
export function toAiSdkTools(
  tools: StoredTool[],
  trace: LangfuseTrace,
  execute: (t: StoredTool, args: Record<string, unknown>) => Promise<ToolResult> = executeTool,
): ToolSet {
  const set: ToolSet = {}
  for (const t of tools) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const p of t.params) {
      const field: z.ZodTypeAny = p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string()
      const described = field.describe(p.description)
      shape[p.name] = p.required ? described : described.optional()
    }
    set[t.name] = tool({
      description: t.description,
      inputSchema: z.object(shape),
      execute: async (args: Record<string, unknown>) => {
        const span = trace.span({ name: `tool:${t.name}`, input: args })
        const r = await execute(t, args)
        span.end({ output: { status: r.status, error: r.error } })
        return r.error ? `error: ${r.error}` : `status ${r.status}\n${r.body}`
      },
    })
  }
  return set
}
```

Replace the `RunDeps` interface, the `safeParse` helper, and the entire `runAgentTurn` body (lines ~176–end of the function) with:

```ts
type StreamResult = { textStream: AsyncIterable<string>; usage: Promise<{ inputTokens?: number; outputTokens?: number }> }
interface RunDeps {
  streamText?: (opts: { model: unknown; system: string; messages: ChatMessage[]; tools?: ToolSet; stopWhen?: unknown }) => StreamResult
  execute?: (t: StoredTool, args: Record<string, unknown>) => Promise<ToolResult>
}

/**
 * Channel-agnostic agent turn. Uses the AI SDK's streamText (routed through AI Gateway) to
 * stream text and run the multi-step tool loop natively (stopWhen: stepCountIs(MAX_ROUNDS)).
 * Keeps the AsyncGenerator<ChatChunk, ChatResult> shape so the channels are unchanged.
 */
export async function* runAgentTurn(
  chatParams: ChatParams,
  tools: StoredTool[],
  trace: LangfuseTrace,
  deps: RunDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  // The default wrapper swaps the model string for the Gateway model, so an injected
  // streamText (tests) never touches createGateway.
  const run = deps.streamText ?? ((opts) =>
    aiStreamText({ ...opts, model: createGateway({ apiKey: chatParams.apiKey })(chatParams.model) } as Parameters<typeof aiStreamText>[0]) as unknown as StreamResult)
  const execute = deps.execute ?? executeTool
  const result = run({
    model: chatParams.model,
    system: chatParams.systemPrompt,
    messages: chatParams.messages,
    tools: tools.length ? toAiSdkTools(tools, trace, execute) : undefined,
    stopWhen: stepCountIs(MAX_ROUNDS),
  })
  for await (const delta of result.textStream) yield { text: delta }
  const u = await result.usage
  return { promptTokens: u.inputTokens ?? 0, completionTokens: u.outputTokens ?? 0 }
}
```

Keep `export const MAX_ROUNDS = 3`. Delete `MAX_CALLS_PER_ROUND` if no longer referenced. `selectExposedTools`, `loadTools`, `executeTool`, `buildToolRequest`, `readCapped`, `StoredTool`, `ToolResult` stay unchanged.

- [ ] **Step 5: Repoint `agent-turn.ts`'s ChatParams import**

In `apps/api/src/lib/chat/agent-turn.ts`, change `import { type ChatParams } from '../llm/openrouter'` to:

```ts
import { type ChatParams } from '../llm/chat'
```

- [ ] **Step 6: Delete the old client + its test**

```bash
git rm apps/api/src/lib/llm/openrouter.ts apps/api/src/lib/llm/openrouter.test.ts
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `cd apps/api && bun test src/lib/chat/tools.test.ts && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS. (Full `bun test` will also pass — only the LLM seam changed and the channel callers are unchanged.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/llm/chat.ts apps/api/src/lib/chat/tools.ts apps/api/src/lib/chat/tools.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "feat(api): runAgentTurn uses AI SDK streamText + AI Gateway (SDK owns the tool loop)"
```

---

### Task 3: `resolveGatewayKey` + agent key resolution

**Files:**
- Modify: `apps/api/src/lib/llm/resolve.ts`
- Test: `apps/api/src/lib/llm/resolve.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts`

**Interfaces:**
- Consumes: `decryptSecret`.
- Produces: `resolveGatewayKey(encryptedAgentKey: string | undefined): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' }` (replaces `resolveOpenRouterKey`).

- [ ] **Step 1: Update the test**

Read `apps/api/src/lib/llm/resolve.test.ts` and replace its `resolveOpenRouterKey` cases with:

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { resolveGatewayKey } from './resolve'
import { encryptSecret } from '../crypto'

const savedKey = process.env.AI_GATEWAY_API_KEY
afterEach(() => { if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = savedKey })

describe('resolveGatewayKey', () => {
  test('uses the decrypted agent key when present', () => {
    process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret'
    const enc = encryptSecret('agent-gw-key')
    const r = resolveGatewayKey(enc)
    expect(r).toEqual({ ok: true, apiKey: 'agent-gw-key' })
  })
  test('falls back to the platform AI_GATEWAY_API_KEY for any provider', () => {
    process.env.AI_GATEWAY_API_KEY = 'platform-gw-key'
    expect(resolveGatewayKey(undefined)).toEqual({ ok: true, apiKey: 'platform-gw-key' })
  })
  test('missing everything → not ok', () => {
    delete process.env.AI_GATEWAY_API_KEY
    expect(resolveGatewayKey(undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
})
```

(`API_KEY_ENCRYPTION_SECRET` must be set for `encryptSecret`; the existing crypto test already relies on it — set it in the first test as shown.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/llm/resolve.test.ts`
Expected: FAIL — `resolveGatewayKey` not exported.

- [ ] **Step 3: Rewrite `resolve.ts`**

Replace the contents of `apps/api/src/lib/llm/resolve.ts`:

```ts
import { decryptSecret } from '../crypto'

/**
 * Resolve the AI Gateway API key for a turn: the agent's own key if set, else the platform
 * AI_GATEWAY_API_KEY (which covers all providers). Returns not-ok if neither is available.
 */
export function resolveGatewayKey(
  encryptedAgentKey: string | undefined,
): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' } {
  if (encryptedAgentKey) {
    return { ok: true, apiKey: decryptSecret(encryptedAgentKey) }
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return { ok: true, apiKey: process.env.AI_GATEWAY_API_KEY }
  }
  return { ok: false, reason: 'missing_key' }
}
```

- [ ] **Step 4: Update `agent-turn.ts` to use it**

In `apps/api/src/lib/chat/agent-turn.ts`:

Change the import `import { resolveOpenRouterKey } from '../llm/resolve'` to:

```ts
import { resolveGatewayKey } from '../llm/resolve'
```

In the `AgentRec` type + `toRec`, rename the `openRouterKey` field to `gatewayKey`:

```ts
  type AgentRec = { id: string; systemPrompt: string; llmModel: string; gatewayKey?: string; knowledgeNamespace: string }
```
```ts
      gatewayKey: d.gatewayKey,
```

In the inline-fallback `agentRec`, change `openRouterKey: workspaceData.openRouterKey` to `gatewayKey: workspaceData.gatewayKey`.

Replace the key-resolution block:

```ts
  const provider = providerOf(llmModel) ?? 'gemini'
  let keyResult
  try {
    keyResult = resolveOpenRouterKey(provider, agentRec.openRouterKey)
  } catch (err) {
```

with:

```ts
  let keyResult
  try {
    keyResult = resolveGatewayKey(agentRec.gatewayKey)
  } catch (err) {
```

(Remove the now-unused `provider` line and the `providerOf` import if it is no longer used anywhere in the file.)

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/api && bun test src/lib/llm/resolve.test.ts && pnpm --filter api typecheck && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/llm/resolve.ts apps/api/src/lib/llm/resolve.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "feat(api): resolve AI Gateway key (per-agent gatewayKey + platform fallback)"
```

---

### Task 4: `gatewayKey` field rename across shared + api routes

**Files:**
- Modify: `packages/shared/src/index.ts` (`AgentDoc.hasOpenRouterKey` → `hasGatewayKey`; `LLMModel.id` comment)
- Modify: `apps/api/src/routes/agents.ts` (`toAgentDoc`, `PUT/DELETE /:id/key`)
- Modify: `apps/api/src/routes/workspace.ts` (`GET /workspace`)

**Interfaces:**
- Produces: `AgentDoc.hasGatewayKey: boolean`; agents store `gatewayKey`; `GET /workspace` returns `hasGatewayKey`.

- [ ] **Step 1: Shared type + comment**

In `packages/shared/src/index.ts`: in `AgentDoc`, rename `hasOpenRouterKey: boolean` to `hasGatewayKey: boolean`. Change the `LLMModel.id` comment from `// OpenRouter slug, e.g. "anthropic/claude-haiku-4.5"` to `// AI Gateway model id, e.g. "anthropic/claude-haiku-4.5"`. Build shared: `pnpm --filter @ayooda/shared build`.

- [ ] **Step 2: agents route**

In `apps/api/src/routes/agents.ts`:
- In `toAgentDoc`, change `hasOpenRouterKey: Boolean(d.openRouterKey)` to `hasGatewayKey: Boolean(d.gatewayKey)`.
- In `PUT /agents/:id/key`, change the write `{ openRouterKey: encryptSecret(apiKey), … }` to `{ gatewayKey: encryptSecret(apiKey), … }`.
- In `DELETE /agents/:id/key`, change `openRouterKey: FieldValue.delete()` to `gatewayKey: FieldValue.delete()`.

- [ ] **Step 3: GET /workspace**

In `apps/api/src/routes/workspace.ts` `GET /`, change `hasOpenRouterKey: Boolean(defAgent ? defAgent.openRouterKey : data.openRouterKey)` to `hasGatewayKey: Boolean(defAgent ? defAgent.gatewayKey : data.gatewayKey)`.

- [ ] **Step 4: api typecheck + build + tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && bun test`
Expected: PASS. (Web typecheck will fail until Task 5 — that is expected; do not run it here.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/routes/agents.ts apps/api/src/routes/workspace.ts
git commit -m "feat: rename per-agent key field to gatewayKey (AgentDoc.hasGatewayKey)"
```

---

### Task 5: Web — gatewayKey + AI Gateway labels

**Files:**
- Modify: `apps/web/src/app/dashboard/agents/page.tsx`
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`

**Interfaces:**
- Consumes: `AgentDoc.hasGatewayKey`; `GET /workspace` `hasGatewayKey`; `/agents/:id/key`.

- [ ] **Step 1: Agents page**

In `apps/web/src/app/dashboard/agents/page.tsx`: every reference to `hasOpenRouterKey` (the `Editor` field, `edit()`, and the "own key" hints) becomes `hasGatewayKey`. Change the key section label/copy from "OpenRouter key" / "sk-or-…" to "AI Gateway key" (placeholder e.g. `vck_…`). The `providerOf(...) !== 'gemini'` "needs a key" hint copy updates to "This model needs an AI Gateway key (below), or set a platform key on the server."

- [ ] **Step 2: Settings page**

In `apps/web/src/app/dashboard/settings/page.tsx`: the workspace-key section reads `hasKey` from `GET /workspace` — change the source field from `hasOpenRouterKey` to `hasGatewayKey`, and relabel the section from "OpenRouter" to "AI Gateway key" (it PUT/DELETEs `/agents/:id/key`, unchanged).

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/agents/page.tsx apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat(web): AI Gateway key labels + hasGatewayKey"
```

---

### Task 6: Env + docs

**Files:**
- Modify: `apps/api/.env.example`
- Modify: `docs/self-hosting.md`

**Interfaces:**
- Produces: `AI_GATEWAY_API_KEY` documented; `OPENROUTER_API_KEY` removed.

- [ ] **Step 1: `.env.example`**

In `apps/api/.env.example`, replace the `OPENROUTER_API_KEY=...` line with:

```bash
AI_GATEWAY_API_KEY=your-vercel-ai-gateway-key   # platform chat routing (all providers); a workspace agent can override with its own
```

- [ ] **Step 2: self-hosting doc**

In `docs/self-hosting.md`: replace the `OPENROUTER_API_KEY` bullet/row (in §1.2 and the api env table) with `AI_GATEWAY_API_KEY` — "Vercel AI Gateway key; routes chat to all providers. A workspace agent can bring its own Gateway key." Update the "What you need" list item from OpenRouter to Vercel AI Gateway.

- [ ] **Step 3: Verify env consistency**

Run: `cd /Users/nick/Projects/ayooda && comm -23 <(grep -rhoE "process\.env\.[A-Z0-9_]+" apps/api/src | sed 's/process\.env\.//' | sort -u | grep -vE "^(WORKSPACE_ID|AGENT_ID|DOC_ID|DOC_TYPE|URL|STORAGE_PATH|PINECONE_NAMESPACE|NODE_ENV)$") <(grep -oE "^#? *[A-Z0-9_]+=" apps/api/.env.example | tr -d '#= ' | sort -u)`
Expected: empty (every api env var, including `AI_GATEWAY_API_KEY`, is templated; `OPENROUTER_API_KEY` no longer referenced in code).

- [ ] **Step 4: Commit**

```bash
git add apps/api/.env.example docs/self-hosting.md
git commit -m "docs: AI_GATEWAY_API_KEY replaces OPENROUTER_API_KEY"
```

---

## Live E2E (after all tasks — from the spec §9)

With a platform `AI_GATEWAY_API_KEY` set on the dev api:

1. Widget chat streams a grounded answer using a **Gemini**, a **Claude**, and an **OpenAI** model (switch the default agent's model) — all routed via AI Gateway; token counts persist per model.
2. A message that triggers a workspace tool → the SDK's multi-step loop calls the tool (SSRF-guarded `executeTool`) and the agent answers from the result.
3. Set a per-agent `gatewayKey` (Agents page → AI Gateway key) → that agent's turns use the agent key instead of the platform key.
4. Telegram parity for one model.
5. Confirm the requests appear in the Vercel AI Gateway dashboard.

Clean up test data.

## Out of scope

Moving embeddings to the AI SDK; Gateway failover/routing/provider-options; AI SDK OpenTelemetry (Langfuse stays); model-catalog changes; any widget/telegram behavior change.
