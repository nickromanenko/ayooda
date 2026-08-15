# Copilot (Internal Team Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authenticated in-app chat surface where workspace members talk to their own agents — a persistent internal assistant that doubles as the agent test bench.

**Architecture:** Extract the reusable middle of `prepareTurn` (agent resolution, retrieval, prompt assembly, tool loading) into four focused modules used by both orchestrators, then add `prepareCopilotTurn` alongside it. Copilot adds no branches to the channel path; `prepareTurn` gets smaller. Threads live under a per-user Firestore path so privacy is structural, in a collection deliberately **not** named `conversations`.

**Tech Stack:** Bun + Hono (API), Firestore, Vercel AI SDK v7 via AI Gateway, Pinecone, Next.js App Router (web), `bun test`.

**Spec:** [docs/superpowers/specs/2026-08-15-copilot-internal-chat-design.md](../specs/2026-08-15-copilot-internal-chat-design.md)

## Global Constraints

- **`prepareTurn`'s behaviour must not change.** Tasks 1–4 are pure refactoring. The existing API test suite (177 tests, including `agent-turn.test.ts`) must pass **unedited** after every one of them. A test that needs editing means the extraction changed behaviour and is wrong. Run the full suite, not just the new tests.
- **`@ayooda/shared` resolves through `packages/shared/dist/`.** After ANY change to `packages/shared`, run `pnpm --filter @ayooda/shared build` before `apps/api` tests or `pnpm typecheck`, or both fail with a misleading `Cannot find module '@ayooda/shared'`.
- `packages/shared` has **zero runtime dependencies** and must keep them. Validation there is hand-rolled `{ ok, value | error }`. No zod.
- Copilot threads are stored at `workspaces/{ws}/copilotUsers/{uid}/threads/{threadId}` — the collection is named **`threads`**, never `conversations`, because `lib/skills/sweep.ts` runs `collectionGroup('conversations')` twice and would otherwise auto-close and score internal chats.
- Exact values: `copilotCap` = **200 / 1000 / 3000** for lite / core / max; `TRIAL_COPILOT_CAP` = **50**; thread `title` truncated to **80** chars; `lastMessage` to **200**; history window **10** messages; retrieval `topK` **5** with score threshold **0.6**.
- Copilot turns: **no** customer-conversation billing gate, **no** escalation rules, **no** scoring skill. Memory and Web Search apply normally.
- Tests are colocated `*.test.ts` under `bun test`, using dependency injection rather than mocking libraries — follow `apps/api/src/lib/workflow/engine.test.ts` and the injectable-deps style of `runAgentTurn`.

---

### Task 1: Extract agent resolution

Each of Tasks 1–4 extracts one block **and rewires `prepareTurn` to use it in the same task**, so the codebase never carries an uncalled module and the regression gate applies at every step.

**Files:**
- Create: `apps/api/src/lib/chat/agent-resolution.ts`
- Create: `apps/api/src/lib/chat/agent-resolution.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts:96-131` (replace the inline block with a call)

**Interfaces:**
- Consumes: `resolveAgentDoc` from `../agents/agent-helpers` (already exists and is tested).
- Produces: `AgentRec` (type), `toAgentRec(id, data, workspaceId)`, `inlineAgentRec(workspaceId, workspaceData)`, `resolveAgentRec(workspaceId, agentId, workspaceData)`. Tasks 5 and 6 both import `AgentRec` and `resolveAgentRec`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/agent-resolution.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { toAgentRec, inlineAgentRec } from './agent-resolution'

describe('toAgentRec', () => {
  test('maps a full agent document', () => {
    expect(toAgentRec('a1', {
      systemPrompt: 'be helpful', llmModel: 'anthropic/claude-haiku-4.5',
      gatewayKey: 'enc', knowledgeNamespace: 'ns_1',
    }, 'ws1')).toEqual({
      id: 'a1', systemPrompt: 'be helpful', llmModel: 'anthropic/claude-haiku-4.5',
      gatewayKey: 'enc', knowledgeNamespace: 'ns_1',
    })
  })

  test('fills defaults for a sparse document', () => {
    const r = toAgentRec('a2', {}, 'ws1')
    expect(r.systemPrompt).toBe('')
    expect(r.llmModel).toBe('google/gemini-2.5-flash')
    expect(r.gatewayKey).toBeUndefined()
    // A missing namespace must fall back to the workspace-wide one, or retrieval
    // would silently query an undefined Pinecone namespace.
    expect(r.knowledgeNamespace).toBe('ws_ws1')
  })
})

describe('inlineAgentRec', () => {
  test('builds the pre-migration fallback from workspace.agent', () => {
    const r = inlineAgentRec('ws1', { agent: { systemPrompt: 'inline p', llmModel: 'openai/gpt-5' }, gatewayKey: 'wk' })
    expect(r).toEqual({
      id: 'inline', systemPrompt: 'inline p', llmModel: 'openai/gpt-5',
      gatewayKey: 'wk', knowledgeNamespace: 'ws_ws1',
    })
  })

  test('tolerates a workspace with no inline agent at all', () => {
    const r = inlineAgentRec('ws1', {})
    expect(r.id).toBe('inline')
    expect(r.systemPrompt).toBe('')
    expect(r.llmModel).toBe('google/gemini-2.5-flash')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/agent-resolution.test.ts`
Expected: FAIL — `Cannot find module './agent-resolution'`.

- [ ] **Step 3: Create `apps/api/src/lib/chat/agent-resolution.ts`**

```ts
import { adminDb } from '../firebase-admin'
import { resolveAgentDoc } from '../agents/agent-helpers'

export type AgentRec = {
  id: string
  systemPrompt: string
  llmModel: string
  gatewayKey?: string
  knowledgeNamespace: string
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash'

export function toAgentRec(
  id: string,
  d: FirebaseFirestore.DocumentData,
  workspaceId: string,
): AgentRec {
  return {
    id,
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
    gatewayKey: d.gatewayKey,
    knowledgeNamespace: d.knowledgeNamespace ?? `ws_${workspaceId}`,
  }
}

/** Pre-migration safety net: workspaces whose agent still lives inline on the workspace doc. */
export function inlineAgentRec(
  workspaceId: string,
  workspaceData: FirebaseFirestore.DocumentData,
): AgentRec {
  const inline = workspaceData.agent ?? {}
  return {
    id: 'inline',
    systemPrompt: inline.systemPrompt ?? '',
    llmModel: inline.llmModel ?? DEFAULT_MODEL,
    gatewayKey: workspaceData.gatewayKey,
    knowledgeNamespace: `ws_${workspaceId}`,
  }
}

/**
 * The requested agent, else the workspace default, else the inline fallback.
 * Never throws — a lookup failure degrades to the inline record so a turn can
 * still produce a reply.
 */
export async function resolveAgentRec(
  workspaceId: string,
  agentId: string | undefined,
  workspaceData: FirebaseFirestore.DocumentData,
): Promise<AgentRec> {
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  try {
    const [specificSnap, defaultSnap] = await Promise.all([
      agentId ? agentsCol.doc(agentId).get() : Promise.resolve(null),
      agentsCol.where('isDefault', '==', true).limit(1).get(),
    ])
    const byId = new Map<string, AgentRec>()
    if (specificSnap && specificSnap.exists) {
      const r = toAgentRec(specificSnap.id, specificSnap.data()!, workspaceId)
      byId.set(r.id, r)
    }
    const defaultAgent = defaultSnap.empty
      ? undefined
      : toAgentRec(defaultSnap.docs[0]!.id, defaultSnap.docs[0]!.data(), workspaceId)
    const resolved = resolveAgentDoc(agentId, byId, defaultAgent)
    if (resolved) return resolved
  } catch (err) {
    console.warn('[agent-turn] agent resolution failed:', err)
  }
  return inlineAgentRec(workspaceId, workspaceData)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/agent-resolution.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire `prepareTurn`**

In `apps/api/src/lib/chat/agent-turn.ts`, replace the whole inline block (from the `// Resolve the agent for this turn:` comment through the `if (!agentRec) { ... }` fallback) with:

```ts
  const agentRec = await resolveAgentRec(workspaceId, agentId, workspaceData)
```

Add the import `import { resolveAgentRec, type AgentRec } from './agent-resolution'`, and delete the now-unused local `AgentRec` type and the `resolveAgentDoc` import if nothing else in the file uses them. The three lines that follow (`systemPrompt`, `storedModel`, `llmModel`) stay exactly as they are.

- [ ] **Step 6: Prove no behaviour changed**

Run: `cd apps/api && bun test`
Expected: **177 pass, 0 fail** plus your 4 new tests — 181 total, with no edits to any existing test file.
Then run: `pnpm typecheck` from the repo root. Expected: clean.

If any pre-existing test fails, revert and re-read the block you replaced — the extraction is wrong, not the test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat/agent-resolution.ts apps/api/src/lib/chat/agent-resolution.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "refactor(api): extract agent resolution from prepareTurn"
```

---

### Task 2: Extract retrieval

**Files:**
- Create: `apps/api/src/lib/chat/retrieval.ts`
- Create: `apps/api/src/lib/chat/retrieval.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (the `// RAG (non-fatal)` block)

**Interfaces:**
- Consumes: `embedText` from `../gemini`, `namespaceFor` from `../pinecone`, `LangfuseTrace` from `../langfuse`.
- Produces: `RetrievedContext` (`{ contextBlocks: string[]; sources: Array<{ docId: string; source: string; score: number }> }`), `selectMatches(matches)`, `retrieveContext(namespace, message, trace, deps?)`. Task 6 imports `retrieveContext`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/retrieval.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { selectMatches, retrieveContext } from './retrieval'

const trace = { span: () => ({ end: () => {} }) } as never

describe('selectMatches', () => {
  test('keeps only matches above the 0.6 threshold', () => {
    const out = selectMatches([
      { score: 0.9, metadata: { docId: 'd1', source: 's1', text: 'keep me' } },
      { score: 0.6, metadata: { docId: 'd2', source: 's2', text: 'exactly at threshold' } },
      { score: 0.59, metadata: { docId: 'd3', source: 's3', text: 'too weak' } },
    ])
    // 0.6 is NOT kept — the existing filter is a strict `>`, and changing it
    // would silently alter every answer's context.
    expect(out.sources.map((s) => s.docId)).toEqual(['d1'])
    expect(out.contextBlocks).toEqual(['keep me'])
  })

  test('drops matches whose text is missing but keeps their source entry', () => {
    const out = selectMatches([{ score: 0.8, metadata: { docId: 'd1', source: 's1' } }])
    expect(out.sources).toHaveLength(1)
    expect(out.contextBlocks).toEqual([])
  })

  test('handles no matches at all', () => {
    expect(selectMatches([])).toEqual({ contextBlocks: [], sources: [] })
    expect(selectMatches(undefined)).toEqual({ contextBlocks: [], sources: [] })
  })
})

describe('retrieveContext', () => {
  test('returns matches on the happy path', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => [0.1, 0.2],
      query: async () => ({ matches: [{ score: 0.9, metadata: { docId: 'd', source: 's', text: 't' } }] }),
    })
    expect(out.contextBlocks).toEqual(['t'])
  })

  test('is non-fatal: an embedding failure yields empty context, never a rejection', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => { throw new Error('gemini down') },
      query: async () => ({ matches: [] }),
    })
    expect(out).toEqual({ contextBlocks: [], sources: [] })
  })

  test('is non-fatal: a Pinecone failure yields empty context', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => [0.1],
      query: async () => { throw new Error('pinecone down') },
    })
    expect(out).toEqual({ contextBlocks: [], sources: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/retrieval.test.ts`
Expected: FAIL — `Cannot find module './retrieval'`.

- [ ] **Step 3: Create `apps/api/src/lib/chat/retrieval.ts`**

```ts
import { embedText } from '../gemini'
import { namespaceFor } from '../pinecone'
import type { LangfuseTrace } from '../langfuse'

export interface RetrievedContext {
  contextBlocks: string[]
  sources: Array<{ docId: string; source: string; score: number }>
}

const TOP_K = 5
const SCORE_THRESHOLD = 0.6

type Match = { score?: number; metadata?: Record<string, unknown> }

/** Pure: the threshold and mapping applied to raw Pinecone matches. */
export function selectMatches(matches: Match[] | undefined): RetrievedContext {
  const good = (matches ?? []).filter((m) => (m.score ?? 0) > SCORE_THRESHOLD)
  return {
    sources: good.map((m) => ({
      docId: (m.metadata?.docId as string) ?? '',
      source: (m.metadata?.source as string) ?? '',
      score: m.score ?? 0,
    })),
    contextBlocks: good.map((m) => (m.metadata?.text as string) ?? '').filter(Boolean),
  }
}

export interface RetrievalDeps {
  embed: (text: string, trace: LangfuseTrace) => Promise<number[]>
  query: (namespace: string, vector: number[]) => Promise<{ matches?: Match[] }>
}

const defaultDeps: RetrievalDeps = {
  embed: (text, trace) => embedText(text, trace),
  query: (namespace, vector) =>
    namespaceFor(namespace).query({ vector, topK: TOP_K, includeMetadata: true }) as Promise<{ matches?: Match[] }>,
}

/** Never rejects — retrieval is non-fatal, and a turn without context beats no reply. */
export async function retrieveContext(
  namespace: string,
  message: string,
  trace: LangfuseTrace,
  deps: RetrievalDeps = defaultDeps,
): Promise<RetrievedContext> {
  try {
    const vector = await deps.embed(message, trace)
    const span = trace.span({ name: 'pinecone-query', input: { topK: TOP_K } })
    const results = await deps.query(namespace, vector)
    span.end({ output: { matches: results.matches?.length ?? 0 } })
    return selectMatches(results.matches)
  } catch (err) {
    console.warn('[agent-turn] RAG retrieval failed:', err)
    return { contextBlocks: [], sources: [] }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/retrieval.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Rewire `prepareTurn`**

Replace the whole `// RAG (non-fatal)` block — the `let contextBlocks`/`let sources` declarations and their surrounding try/catch — with:

```ts
  const { contextBlocks, sources } = await retrieveContext(agentRec.knowledgeNamespace, trimmed, trace)
```

Add `import { retrieveContext } from './retrieval'`. Remove the now-unused `embedText` and `namespaceFor` imports **only if** nothing else in the file uses them.

- [ ] **Step 6: Prove no behaviour changed**

Run: `cd apps/api && bun test` → all pre-existing tests pass unedited.
Run: `pnpm typecheck` from the repo root → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat/retrieval.ts apps/api/src/lib/chat/retrieval.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "refactor(api): extract RAG retrieval from prepareTurn"
```

---

### Task 3: Extract prompt assembly

**Files:**
- Create: `apps/api/src/lib/chat/prompt.ts`
- Create: `apps/api/src/lib/chat/prompt.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (the `allBlocks` / `contextSection` / `chatMessages` block)

**Interfaces:**
- Consumes: `ChatParams`, `ChatMessage` from `../llm/chat`.
- Produces: `buildChatParams(input)` where input is `{ systemPrompt: string; contextBlocks: string[]; skillBlocks: string[]; history: Array<{ role: string; content: string }>; message: string; apiKey: string; model: string }` → `ChatParams`. Task 6 imports it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/prompt.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildChatParams } from './prompt'

const base = {
  systemPrompt: 'You are helpful.',
  contextBlocks: [] as string[],
  skillBlocks: [] as string[],
  history: [] as Array<{ role: string; content: string }>,
  message: 'hi',
  apiKey: 'k',
  model: 'google/gemini-2.5-flash',
}

describe('buildChatParams', () => {
  test('leaves the system prompt untouched when there is no context', () => {
    expect(buildChatParams(base).systemPrompt).toBe('You are helpful.')
  })

  test('appends knowledge and skill blocks into one context section', () => {
    const p = buildChatParams({ ...base, contextBlocks: ['doc text'], skillBlocks: ['memory text'] })
    expect(p.systemPrompt).toContain('You are helpful.')
    expect(p.systemPrompt).toContain('doc text')
    expect(p.systemPrompt).toContain('memory text')
    // One section, not two — knowledge context and skill context share a block.
    expect(p.systemPrompt.match(/Use the following knowledge base context/g)).toHaveLength(1)
  })

  test('knowledge blocks come before skill blocks', () => {
    const p = buildChatParams({ ...base, contextBlocks: ['AAA'], skillBlocks: ['BBB'] })
    expect(p.systemPrompt.indexOf('AAA')).toBeLessThan(p.systemPrompt.indexOf('BBB'))
  })

  test('drops the final history entry and appends the current message', () => {
    // prepareTurn persists the user message BEFORE reading history, so the last
    // history row is the current message — including it would duplicate it.
    const p = buildChatParams({
      ...base,
      history: [
        { role: 'user', content: 'older question' },
        { role: 'assistant', content: 'older answer' },
        { role: 'user', content: 'hi' },
      ],
      message: 'hi',
    })
    expect(p.messages).toEqual([
      { role: 'user', content: 'older question' },
      { role: 'assistant', content: 'older answer' },
      { role: 'user', content: 'hi' },
    ])
  })

  test('maps any non-user role to assistant', () => {
    const p = buildChatParams({ ...base, history: [{ role: 'operator', content: 'from a human' }, { role: 'user', content: 'hi' }] })
    expect(p.messages[0]).toEqual({ role: 'assistant', content: 'from a human' })
  })

  test('passes model and apiKey through', () => {
    const p = buildChatParams({ ...base, model: 'openai/gpt-5', apiKey: 'secret' })
    expect(p.model).toBe('openai/gpt-5')
    expect(p.apiKey).toBe('secret')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Create `apps/api/src/lib/chat/prompt.ts`**

```ts
import type { ChatMessage, ChatParams } from '../llm/chat'

export interface BuildChatParamsInput {
  systemPrompt: string
  contextBlocks: string[]
  skillBlocks: string[]
  /** Oldest-first. The final entry is the current message and is dropped. */
  history: Array<{ role: string; content: string }>
  message: string
  apiKey: string
  model: string
}

/** Pure: the single place the context section and message array are assembled. */
export function buildChatParams(input: BuildChatParamsInput): ChatParams {
  const allBlocks = [...input.contextBlocks, ...input.skillBlocks]
  const contextSection =
    allBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${allBlocks.join('\n\n')}\n---`
      : ''

  const messages: ChatMessage[] = input.history.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))
  messages.push({ role: 'user', content: input.message })

  return {
    model: input.model,
    systemPrompt: input.systemPrompt + contextSection,
    messages,
    apiKey: input.apiKey,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/prompt.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Rewire `prepareTurn`**

Replace the `allBlocks` / `contextSection` / `fullSystemPrompt` / `chatMessages` block with nothing, and change the returned `chatParams` to:

```ts
    chatParams: buildChatParams({
      systemPrompt,
      contextBlocks,
      skillBlocks,
      history,
      message: trimmed,
      apiKey: keyResult.apiKey,
      model: llmModel,
    }),
```

Add `import { buildChatParams } from './prompt'`.

- [ ] **Step 6: Prove no behaviour changed**

Run: `cd apps/api && bun test` → all pre-existing tests pass unedited.
Run: `pnpm typecheck` from the repo root → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat/prompt.ts apps/api/src/lib/chat/prompt.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "refactor(api): extract prompt assembly from prepareTurn"
```

---

### Task 4: Extract tool loading

**Files:**
- Create: `apps/api/src/lib/chat/turn-tools.ts`
- Create: `apps/api/src/lib/chat/turn-tools.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (the `loadTools` and `gatherTools` blocks)

**Interfaces:**
- Consumes: `loadTools`, `StoredTool` from `./tools`; `gatherTools` from `../skills/run`; `LoadedSkill` from `../skills/registry`; `SkillContext` from `../skills/types`.
- Produces: `loadTurnTools(workspaceId, agentId, skills, skillCtx, deps?)` → `{ tools: StoredTool[]; skillTools: ToolSet }`. Task 6 imports it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/turn-tools.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { loadTurnTools } from './turn-tools'

const ctx = { workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v', message: 'hi', config: {}, trace: { span: () => ({ end: () => {} }) } } as never

describe('loadTurnTools', () => {
  test('returns both customer tools and skill tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => [{ id: 't1', name: 'lookup' }] as never,
      gatherTools: async () => ({ web_search: {} as never }),
    })
    expect(out.tools).toHaveLength(1)
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
  })

  test('a customer tool-load failure still yields skill tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => { throw new Error('firestore down') },
      gatherTools: async () => ({ web_search: {} as never }),
    })
    expect(out.tools).toEqual([])
    expect(Object.keys(out.skillTools)).toEqual(['web_search'])
  })

  test('a skill tool failure still yields customer tools', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => [{ id: 't1', name: 'lookup' }] as never,
      gatherTools: async () => { throw new Error('boom') },
    })
    expect(out.tools).toHaveLength(1)
    expect(out.skillTools).toEqual({})
  })

  test('never rejects even when both fail', async () => {
    const out = await loadTurnTools('w', 'a', [], ctx, {
      loadTools: async () => { throw new Error('a') },
      gatherTools: async () => { throw new Error('b') },
    })
    expect(out).toEqual({ tools: [], skillTools: {} })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/turn-tools.test.ts`
Expected: FAIL — `Cannot find module './turn-tools'`.

- [ ] **Step 3: Create `apps/api/src/lib/chat/turn-tools.ts`**

```ts
import type { ToolSet } from 'ai'
import { loadTools as defaultLoadTools, type StoredTool } from './tools'
import { gatherTools as defaultGatherTools } from '../skills/run'
import type { LoadedSkill } from '../skills/registry'
import type { SkillContext } from '../skills/types'

export interface TurnToolsDeps {
  loadTools: (workspaceId: string, agentId: string) => Promise<StoredTool[]>
  gatherTools: (skills: LoadedSkill[], ctx: SkillContext<unknown>) => Promise<ToolSet>
}

const defaultDeps: TurnToolsDeps = {
  loadTools: defaultLoadTools,
  gatherTools: defaultGatherTools,
}

/**
 * Customer tools and skill tools, each independently non-fatal: one source
 * failing must not cost the turn the other's tools.
 */
export async function loadTurnTools(
  workspaceId: string,
  agentId: string,
  skills: LoadedSkill[],
  skillCtx: SkillContext<unknown>,
  deps: TurnToolsDeps = defaultDeps,
): Promise<{ tools: StoredTool[]; skillTools: ToolSet }> {
  let tools: StoredTool[] = []
  try {
    tools = await deps.loadTools(workspaceId, agentId)
  } catch (err) {
    console.warn('[agent-turn] tool load failed:', err)
  }

  let skillTools: ToolSet = {}
  try {
    if (skills.length) skillTools = await deps.gatherTools(skills, skillCtx)
  } catch (err) {
    console.warn('[skills] gatherTools failed:', err)
  }

  return { tools, skillTools }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/turn-tools.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire `prepareTurn`**

Replace both the `// Tool/webhook actions` block and the `// Skill tools` block with:

```ts
  const { tools, skillTools } = await loadTurnTools(workspaceId, agentRec.id, skills, skillCtx)
```

Add `import { loadTurnTools } from './turn-tools'`. Remove the now-unused `loadTools` and `gatherTools` imports **only if** nothing else in the file uses them.

- [ ] **Step 6: Prove no behaviour changed**

Run: `cd apps/api && bun test` → all pre-existing tests pass unedited.
Run: `pnpm typecheck` from the repo root → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/chat/turn-tools.ts apps/api/src/lib/chat/turn-tools.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "refactor(api): extract tool loading from prepareTurn"
```

---

### Task 5: Copilot billing constants and types

**Files:**
- Modify: `packages/shared/src/plans.ts` (add `copilotCap`, `TRIAL_COPILOT_CAP`)
- Modify: `packages/shared/src/index.ts` (add `copilotPeriodCount` to `WorkspaceUsage`, add `CopilotThreadDoc`)
- Modify: `packages/shared/src/index.test.ts` (extend the existing billing-plans test)
- Create: `apps/api/src/lib/billing/copilot-entitlement.ts`
- Create: `apps/api/src/lib/billing/copilot-entitlement.test.ts`

**Interfaces:**
- Consumes: `PlanTier`, `Subscription`, `planFor` from `@ayooda/shared`.
- Produces: `PlanDef.copilotCap`, `TRIAL_COPILOT_CAP`, `WorkspaceUsage.copilotPeriodCount`, `CopilotThreadDoc`, and `checkCopilotEntitlement({ subscription, copilotPeriodCount })` → `{ entitled: boolean; cap: number }`. Tasks 6 and 7 import `checkCopilotEntitlement`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/billing/copilot-entitlement.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { checkCopilotEntitlement } from './copilot-entitlement'
import type { Subscription } from '@ayooda/shared'

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  status: 'active', tier: 'core', trialEndsAt: null, currentPeriodEnd: null,
  stripeCustomerId: null, stripeSubscriptionId: null, ...over,
})

describe('checkCopilotEntitlement', () => {
  test('uses the plan cap for a paid tier', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 999 }))
      .toEqual({ entitled: true, cap: 1000 })
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 1000 }))
      .toEqual({ entitled: false, cap: 1000 })
  })

  test('lite and max use their own caps', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 199 }).entitled).toBe(true)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 200 }).entitled).toBe(false)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'max' }), copilotPeriodCount: 2999 }).entitled).toBe(true)
  })

  test('a trial workspace falls back to the trial cap, not a plan cap', () => {
    // tier is null on trial — PlanDef has no trial row, so planFor() returns undefined.
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 49 })
    expect(r).toEqual({ entitled: true, cap: 50 })
    expect(checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 50 }).entitled).toBe(false)
  })

  test('no subscription at all is treated as trial', () => {
    expect(checkCopilotEntitlement({ subscription: undefined, copilotPeriodCount: 0 }))
      .toEqual({ entitled: true, cap: 50 })
  })

  test('a missing counter is treated as zero', () => {
    expect(checkCopilotEntitlement({ subscription: sub(), copilotPeriodCount: undefined }).entitled).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/billing/copilot-entitlement.test.ts`
Expected: FAIL — `Cannot find module './copilot-entitlement'`.

- [ ] **Step 3: Add the shared constants and types**

In `packages/shared/src/plans.ts`, add `copilotCap` to the `PlanDef` interface and to each row, and add the trial constant next to `TRIAL_CONVERSATION_CAP`:

```ts
export interface PlanDef {
  tier: PlanTier
  name: string
  priceUsd: number
  conversationCap: number
  /** Internal Copilot threads per period. A spend guard, not a billed line. */
  copilotCap: number
}

export const PLANS: readonly PlanDef[] = [
  { tier: 'lite', name: 'Lite', priceUsd: 25, conversationCap: 100, copilotCap: 200 },
  { tier: 'core', name: 'Core', priceUsd: 55, conversationCap: 500, copilotCap: 1000 },
  { tier: 'max', name: 'Max', priceUsd: 195, conversationCap: 1500, copilotCap: 3000 },
]

export const TRIAL_COPILOT_CAP = 50
```

In `packages/shared/src/index.ts`, add to `WorkspaceUsage`:

```ts
  copilotPeriodCount?: number   // internal Copilot threads this period
```

and add the thread type at the end of the file:

```ts
/** workspaces/{ws}/copilotUsers/{uid}/threads/{threadId} */
export interface CopilotThreadDoc {
  uid: string
  agentId: string
  title: string          // first user message, truncated to 80 chars
  createdAt: Date
  updatedAt: Date
  lastMessage: string    // truncated to 200 chars
}
```

In `packages/shared/src/index.test.ts`, extend the existing `three tiers with the agreed caps and prices` test with the new field so the caps are pinned:

```ts
    expect(PLANS.map((p) => p.copilotCap)).toEqual([200, 1000, 3000])
    expect(TRIAL_COPILOT_CAP).toBe(50)
```

adding `TRIAL_COPILOT_CAP` to that file's import.

- [ ] **Step 4: Create `apps/api/src/lib/billing/copilot-entitlement.ts`**

```ts
import { planFor, TRIAL_COPILOT_CAP, type Subscription } from '@ayooda/shared'

/**
 * Copilot has its own allowance and never touches the customer-conversation
 * quota. Checked once per thread, when its first message is written.
 */
export function checkCopilotEntitlement({
  subscription,
  copilotPeriodCount,
}: {
  subscription: Subscription | undefined
  copilotPeriodCount: number | undefined
}): { entitled: boolean; cap: number } {
  const plan = planFor(subscription?.tier ?? null)
  const cap = plan?.copilotCap ?? TRIAL_COPILOT_CAP
  return { entitled: (copilotPeriodCount ?? 0) < cap, cap }
}
```

- [ ] **Step 5: Build shared, then run the tests**

```bash
pnpm --filter @ayooda/shared build
cd packages/shared && bun test
cd ../../apps/api && bun test src/lib/billing/copilot-entitlement.test.ts
```

Expected: shared tests pass with the extended assertions; the 5 copilot-entitlement tests pass.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/shared/src/plans.ts packages/shared/src/index.ts packages/shared/src/index.test.ts apps/api/src/lib/billing/copilot-entitlement.ts apps/api/src/lib/billing/copilot-entitlement.test.ts
git commit -m "feat(shared): Copilot usage caps, thread type and entitlement check"
```

---

### Task 6: `prepareCopilotTurn`

**Files:**
- Create: `apps/api/src/lib/chat/copilot-turn.ts`
- Create: `apps/api/src/lib/chat/copilot-turn.test.ts`

**Interfaces:**
- Consumes: `resolveAgentRec` (Task 1), `retrieveContext` (Task 2), `buildChatParams` (Task 3), `loadTurnTools` (Task 4), `loadEnabledSkills`/`LoadedSkill` from `../skills/registry`, `gatherContext` from `../skills/run`, `resolveGatewayKey` from `../llm/resolve`, `LEGACY_MODEL_MAP` from `../gemini`.
- Produces: `PrepareCopilotTurnInput`, `PreparedCopilotTurn`, `ReadyCopilotTurn` (carries `trace`), `skillsForCopilot(skills)`, `prepareCopilotTurn(input)`. Task 7 imports `prepareCopilotTurn` and reads `prepared.trace`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/chat/copilot-turn.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { skillsForCopilot } from './copilot-turn'
import type { LoadedSkill } from '../skills/registry'

const loaded = (id: string): LoadedSkill => ({
  def: { id: id as never, label: id, description: '', defaultConfig: {}, minTier: null },
  module: { id: id as never },
  config: {},
})

describe('skillsForCopilot', () => {
  test('drops scoring — internal chats must not pollute conversation-quality metrics', () => {
    const out = skillsForCopilot([loaded('memory'), loaded('scoring'), loaded('web_search')])
    expect(out.map((s) => s.def.id)).toEqual(['memory', 'web_search'])
  })

  test('keeps everything else, including an empty list', () => {
    expect(skillsForCopilot([])).toEqual([])
    expect(skillsForCopilot([loaded('memory')]).map((s) => s.def.id)).toEqual(['memory'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/chat/copilot-turn.test.ts`
Expected: FAIL — `Cannot find module './copilot-turn'`.

- [ ] **Step 3: Create `apps/api/src/lib/chat/copilot-turn.ts`**

```ts
import type { ToolSet } from 'ai'
import { adminDb } from '../firebase-admin'
import { getLangfuse, type LangfuseTrace } from '../langfuse'
import { LEGACY_MODEL_MAP } from '../gemini'
import { resolveGatewayKey } from '../llm/resolve'
import type { ChatParams } from '../llm/chat'
import { loadEnabledSkills, type LoadedSkill } from '../skills/registry'
import { gatherContext } from '../skills/run'
import '../skills/all'
import { resolveAgentRec } from './agent-resolution'
import { retrieveContext } from './retrieval'
import { buildChatParams } from './prompt'
import { loadTurnTools } from './turn-tools'
import type { StoredTool } from './tools'
import type { PlanTier } from '@ayooda/shared'

const HISTORY_WINDOW = 10

export interface PrepareCopilotTurnInput {
  workspaceId: string
  uid: string
  threadId: string
  agentId: string
  message: string
}

export interface ReadyCopilotTurn {
  kind: 'ready'
  chatParams: ChatParams
  sources: Array<{ docId: string; source: string; score: number }>
  tools: StoredTool[]
  skillTools: ToolSet
  /** The live Langfuse trace. The route passes it to runAgentTurn so tool-call
   *  spans attach to this turn instead of a throwaway trace. */
  trace: LangfuseTrace
  persist: (reply: string) => Promise<string>
}

export type PreparedCopilotTurn = ReadyCopilotTurn | { kind: 'error'; error: string }

/**
 * Scoring exists to grade customer conversations for the owner; running it on
 * internal chats would pollute those metrics with staff traffic.
 */
export function skillsForCopilot(skills: LoadedSkill[]): LoadedSkill[] {
  return skills.filter((s) => s.def.id !== 'scoring')
}

export async function prepareCopilotTurn(
  input: PrepareCopilotTurnInput,
): Promise<PreparedCopilotTurn> {
  const { workspaceId, uid, threadId, agentId, message } = input
  const trimmed = message.trim()

  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!workspaceSnap.exists) return { kind: 'error', error: 'Workspace not found' }
  const workspaceData = workspaceSnap.data()!

  const agentRec = await resolveAgentRec(workspaceId, agentId, workspaceData)
  const storedModel = agentRec.llmModel
  const llmModel = LEGACY_MODEL_MAP[storedModel] ?? storedModel

  const trace = getLangfuse().trace({
    name: 'copilot-chat',
    sessionId: threadId,
    userId: uid,
    input: { message: trimmed },
    metadata: { workspaceId, agentId: agentRec.id, llmModel, surface: 'copilot' },
  })

  const threadRef = adminDb.doc(`workspaces/${workspaceId}/copilotUsers/${uid}/threads/${threadId}`)
  const messagesRef = threadRef.collection('messages')
  await messagesRef.add({ role: 'user', content: trimmed, createdAt: new Date() })

  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(HISTORY_WINDOW).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  let skills: LoadedSkill[] = []
  try {
    const tier = (workspaceData.subscription?.tier as PlanTier | null | undefined) ?? null
    skills = skillsForCopilot(await loadEnabledSkills(workspaceId, agentRec.id, tier))
  } catch (err) {
    console.warn('[copilot] skill load failed:', err)
  }

  const { contextBlocks, sources } = await retrieveContext(agentRec.knowledgeNamespace, trimmed, trace)

  // The visitor identity for a Copilot turn is the team member, so per-visitor
  // Memory remembers facts about staff — which is the intent.
  const skillCtx = {
    workspaceId, agentId: agentRec.id, conversationId: threadId, visitorId: uid,
    message: trimmed, config: {}, trace,
  }
  let skillBlocks: string[] = []
  try {
    if (skills.length) skillBlocks = await gatherContext(skills, skillCtx)
  } catch (err) {
    console.warn('[copilot] gatherContext failed:', err)
  }

  let keyResult
  try {
    keyResult = resolveGatewayKey(agentRec.gatewayKey)
  } catch (err) {
    console.error('[copilot] key resolution failed:', err)
    return { kind: 'error', error: 'AI model needs an API key' }
  }
  if (!keyResult.ok) return { kind: 'error', error: 'AI model needs an API key' }

  const { tools, skillTools } = await loadTurnTools(workspaceId, agentRec.id, skills, skillCtx)

  const persist = async (reply: string): Promise<string> => {
    const ref = await messagesRef.add({
      role: 'assistant', content: reply, createdAt: new Date(),
      metadata: { sources, llmModel },
    })
    await threadRef.update({ updatedAt: new Date(), lastMessage: reply.slice(0, 200) }).catch(() => {})
    trace.update({ output: { message: reply, sources } })
    return ref.id
  }

  return {
    kind: 'ready',
    chatParams: buildChatParams({
      systemPrompt: agentRec.systemPrompt,
      contextBlocks, skillBlocks, history,
      message: trimmed, apiKey: keyResult.apiKey, model: llmModel,
    }),
    sources, tools, skillTools, trace, persist,
  }
}
```

Note what is absent, deliberately: no billing gate on `periodConversationCount`, no `evaluateSilenceGate`, no escalation-rule evaluation, and no conversation document in `workspaces/{ws}/conversations`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/chat/copilot-turn.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Full suite and typecheck**

Run: `cd apps/api && bun test` then `pnpm typecheck` from the repo root. Expected: everything passes, nothing pre-existing edited.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/chat/copilot-turn.ts apps/api/src/lib/chat/copilot-turn.test.ts
git commit -m "feat(api): prepareCopilotTurn — internal chat orchestrator"
```

---

### Task 7: Copilot routes

**Files:**
- Create: `apps/api/src/routes/copilot.ts`
- Create: `apps/api/src/routes/copilot-helpers.test.ts`
- Modify: `apps/api/src/index.ts` (mount `/copilot`)

**Interfaces:**
- Consumes: `prepareCopilotTurn` (Task 6), `checkCopilotEntitlement` (Task 5), `shouldResetPeriod` from `../lib/billing/entitlement`, `runAgentTurn` from `../lib/chat/tools`, `requireAuth` from `../middleware/auth`.
- Produces: `GET /copilot/threads`, `POST /copilot/chat`, `DELETE /copilot/threads/:id`; and the exported pure helpers `threadTitle(message)` and `validateChatBody(raw)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/copilot-helpers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { threadTitle, validateChatBody } from './copilot'

describe('threadTitle', () => {
  test('uses the message, truncated to 80 chars', () => {
    expect(threadTitle('How do refunds work?')).toBe('How do refunds work?')
    expect(threadTitle('x'.repeat(200))).toHaveLength(80)
  })
  test('trims and falls back for an empty message', () => {
    expect(threadTitle('   hi   ')).toBe('hi')
    expect(threadTitle('   ')).toBe('New thread')
  })
})

describe('validateChatBody', () => {
  test('accepts a continue request', () => {
    expect(validateChatBody({ message: 'hi', threadId: 't1' }))
      .toEqual({ ok: true, value: { message: 'hi', threadId: 't1' } })
  })
  test('accepts a start request', () => {
    expect(validateChatBody({ message: 'hi', agentId: 'a1' }))
      .toEqual({ ok: true, value: { message: 'hi', agentId: 'a1' } })
  })
  test('rejects neither threadId nor agentId', () => {
    expect(validateChatBody({ message: 'hi' }).ok).toBe(false)
  })
  test('rejects both together — ambiguous whether to start or continue', () => {
    expect(validateChatBody({ message: 'hi', threadId: 't1', agentId: 'a1' }).ok).toBe(false)
  })
  test('rejects an empty or missing message', () => {
    expect(validateChatBody({ threadId: 't1' }).ok).toBe(false)
    expect(validateChatBody({ message: '   ', threadId: 't1' }).ok).toBe(false)
    expect(validateChatBody(null).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/copilot-helpers.test.ts`
Expected: FAIL — `Cannot find module './copilot'`.

- [ ] **Step 3: Create `apps/api/src/routes/copilot.ts`**

Model the router on `apps/api/src/routes/tools.ts` for conventions and on `apps/api/src/routes/widget.ts` for the SSE shape. Read both before writing.

```ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { rateLimit } from '../lib/rate-limit'
import { checkCopilotEntitlement } from '../lib/billing/copilot-entitlement'
import { shouldResetPeriod } from '../lib/billing/entitlement'
import { prepareCopilotTurn } from '../lib/chat/copilot-turn'
import { runAgentTurn } from '../lib/chat/tools'

const copilot = new Hono<{ Variables: AuthVariables }>()
copilot.use('*', requireAuth)

const TITLE_MAX = 80
const CHAT_LIMIT_PER_USER = 30
const RATE_WINDOW_MS = 60_000

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

const threadsCol = (ws: string, uid: string) =>
  adminDb.collection(`workspaces/${ws}/copilotUsers/${uid}/threads`)

/** GET /copilot/threads — the caller's own threads, newest first. */
copilot.get('/threads', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const snap = await threadsCol(ws, uid).orderBy('updatedAt', 'desc').limit(50).get()
  return c.json({ threads: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })
})

/** DELETE /copilot/threads/:id */
copilot.delete('/threads/:id', async (c) => {
  const ws = c.get('workspaceId')
  const uid = c.get('uid')
  const ref = threadsCol(ws, uid).doc(c.req.param('id'))
  const msgs = await ref.collection('messages').get()
  for (const d of msgs.docs) await d.ref.delete()
  await ref.delete()
  return c.json({ ok: true })
})

/** POST /copilot/chat — SSE. threadId to continue, agentId to start. */
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

  if (resolvedThreadId) {
    // A thread belonging to another user is not addressable under this path, so
    // a cross-user attempt simply 404s without an ownership comparison.
    const snap = await threadsCol(ws, uid).doc(resolvedThreadId).get()
    if (!snap.exists) return c.json({ error: 'Thread not found' }, 404)
    resolvedAgentId = snap.data()!.agentId as string
  } else {
    const agentSnap = await adminDb.doc(`workspaces/${ws}/agents/${resolvedAgentId}`).get()
    if (!agentSnap.exists) return c.json({ error: 'Agent not found' }, 404)

    // The cap is checked once per thread, on creation — never per message.
    const wsSnap = await adminDb.doc(`workspaces/${ws}`).get()
    const wsData = wsSnap.data() ?? {}
    const usage = wsData.usage ?? {}
    const now = new Date()

    // Copilot must perform the SAME period rollover prepareTurn does. It is the
    // only other writer of this counter, and a workspace that uses Copilot but
    // has no customer traffic would otherwise never advance periodStart — the
    // cap would be permanently exhausted after the first period.
    const periodStart = usage.periodStart?.toDate?.() ?? usage.periodStart ?? null
    const sub = wsData.subscription
    const reset = shouldResetPeriod(periodStart, now, sub)
    const effectiveCount = reset ? 0 : (usage.copilotPeriodCount ?? 0)

    const ent = checkCopilotEntitlement({ subscription: sub, copilotPeriodCount: effectiveCount })
    if (!ent.entitled) {
      return c.json({ error: `Internal chat limit reached (${ent.cap} threads this period).`, reason: 'copilot_limit' }, 402)
    }

    const ref = threadsCol(ws, uid).doc()
    await ref.set({
      uid, agentId: resolvedAgentId, title: threadTitle(message),
      createdAt: now, updatedAt: now, lastMessage: message.slice(0, 200),
    })

    // Both counters share one periodStart, so a rollover must reset BOTH in a
    // single update. Advancing periodStart while leaving periodConversationCount
    // high would block the workspace's real customers — far worse than the bug
    // this fixes. No customer conversation happened here, hence 0.
    await adminDb.doc(`workspaces/${ws}`).update(
      reset
        ? { 'usage.periodStart': now, 'usage.periodConversationCount': 0, 'usage.copilotPeriodCount': 1 }
        : { 'usage.copilotPeriodCount': FieldValue.increment(1) },
    )
    resolvedThreadId = ref.id
  }

  const prepared = await prepareCopilotTurn({
    workspaceId: ws, uid, threadId: resolvedThreadId!, agentId: resolvedAgentId!, message,
  })
  if (prepared.kind === 'error') return c.json({ error: prepared.error }, 502)

  return streamSSE(c, async (stream) => {
    let reply = ''
    try {
      const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools)
      let next = await gen.next()
      while (!next.done) {
        reply += next.value.text
        await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: next.value.text }) })
        next = await gen.next()
      }
      const messageId = await prepared.persist(reply)
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ threadId: resolvedThreadId, messageId, sources: prepared.sources }),
      })
    } catch (err) {
      console.error('[copilot] stream failed:', err)
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Something went wrong' }) })
    }
  })
})

export default copilot
```

Before finalising the `runAgentTurn` call, open `apps/api/src/routes/widget.ts` and copy how it drives the generator and passes the Langfuse trace — match that exactly rather than the sketch above if they differ.

- [ ] **Step 4: Mount the router**

In `apps/api/src/index.ts`, alongside the other authenticated routers:

```ts
import copilotRoutes from './routes/copilot'
app.route('/copilot', copilotRoutes)
```

- [ ] **Step 5: Run tests and typecheck**

```bash
cd apps/api && bun test
pnpm typecheck
```

Expected: the 10 new helper tests pass, nothing pre-existing breaks.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/copilot.ts apps/api/src/routes/copilot-helpers.test.ts apps/api/src/index.ts
git commit -m "feat(api): Copilot threads and streaming chat routes"
```

---

### Task 8: Firestore rules for per-user thread access

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: the thread path from Task 7.
- Produces: client read access scoped to the owning user.

- [ ] **Step 1: Add the rule**

In `firestore.rules`, inside the existing `match /workspaces/{workspaceId}` block, alongside the `conversations` match:

```
      // Copilot threads are private to the member who created them. The {uid}
      // path segment does the enforcing — there is no field comparison and no
      // get() lookup, and another member's threads are simply not addressable.
      // Writes are server-only; the client reads so the UI can stream a thread.
      match /copilotUsers/{uid}/threads/{threadId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;

        match /messages/{messageId} {
          allow read: if request.auth != null && request.auth.uid == uid;
          allow write: if false;
        }
      }
```

- [ ] **Step 2: Verify the rules compile**

```bash
firebase deploy --only firestore:rules --dry-run
```

Expected: `rules file firestore.rules compiled successfully`. If `--dry-run` is unsupported by the installed CLI version, run `firebase deploy --only firestore:rules` — the compile check runs first and a syntax error fails before anything is published.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(rules): per-user read access for Copilot threads"
```

---

### Task 9: Copilot page

**Files:**
- Create: `apps/web/src/lib/sse.ts`
- Create: `apps/web/src/app/dashboard/copilot/page.tsx`
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx` (add the nav entry)

**Interfaces:**
- Consumes: the routes from Task 7; `apiRequest` from `@/lib/api`; `AgentDoc`, `CopilotThreadDoc` from `@ayooda/shared`; `AgentAvatar` from `@/components/dashboard/AgentAvatar`.
- Produces: `readSSE(res, handlers)` in `apps/web/src/lib/sse.ts`.

- [ ] **Step 1: Create the SSE reader**

`apps/web` has no SSE consumer; the widget's lives in a separate bundle that Next.js cannot import. Create `apps/web/src/lib/sse.ts`:

```ts
/**
 * Minimal SSE reader for fetch responses. The dashboard's second copy of this
 * loop (the widget has the first) — sharing it would need a browser-targeted
 * package, since packages/shared is deliberately dependency-free and DOM-free.
 */
export async function readSSE(
  res: Response,
  handlers: { onEvent: (event: string, data: string) => void },
): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) handlers.onEvent(event, data)
    }
  }
}
```

- [ ] **Step 2: Create the page**

Create `apps/web/src/app/dashboard/copilot/page.tsx` as a client component. Read `apps/web/src/app/dashboard/agents/page.tsx` first and reuse its `card` / `label` / `input` style objects and the `apiRequest` idiom (raw `Response`, check `res.ok`, read `error` off the parsed body). The house error colour is `#f87171`; `var(--danger)` does not exist.

Structure:

- State: `threads`, `activeThreadId`, `messages`, `agents`, `pendingAgentId`, `input`, `streaming`, `error`.
- On mount: `GET /agents` for the picker and `GET /copilot/threads` for the list. Read `?agent=` from `useSearchParams()` and put it in `pendingAgentId` — that opens a composer targeting that agent **without creating a thread**.
- Left column: a "New thread" control with the agent picker, then the thread list (title, `AgentAvatar` for its agent, relative time). Selecting a thread loads its messages with a client Firestore `onSnapshot` on `workspaces/{ws}/copilotUsers/{uid}/threads/{id}/messages` ordered by `createdAt`, exactly as `apps/web/src/app/dashboard/inbox/page.tsx` does for conversation messages — the Task 8 rules exist precisely so this works.
- Right column: the message list (user right, assistant left), source chips rendered from `metadata.sources`, and a composer.
- A 402 response shows the `error` string as-is — it already says "Internal chat limit reached", which must not be confused with the customer-conversation limit.

The send handler is the part with real subtlety, so write it exactly like this:

```tsx
  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput(''); setError(''); setStreaming(true)
    setPending('')                       // the in-flight assistant reply

    try {
      const body = activeThreadId
        ? { message: text, threadId: activeThreadId }
        : { message: text, agentId: pendingAgentId }

      const res = await apiRequest('/copilot/chat', { method: 'POST', body: JSON.stringify(body) })

      // Errors come back as JSON, not SSE — check before reading the stream.
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Could not send the message')
        return
      }

      let buffer = ''
      await readSSE(res, {
        onEvent: (event, data) => {
          if (event === 'chunk') {
            buffer += (JSON.parse(data) as { text: string }).text
            setPending(buffer)
          } else if (event === 'done') {
            const d = JSON.parse(data) as { threadId: string }
            // Setting the id switches the onSnapshot listener onto this thread,
            // which then supplies the persisted message — so clear the local
            // buffer to avoid rendering the reply twice.
            setActiveThreadId(d.threadId)
            setPending('')
            void loadThreads()
          } else if (event === 'error') {
            setError((JSON.parse(data) as { error: string }).error)
            setPending('')
          }
        },
      })
    } catch {
      setError('Connection lost')
    } finally {
      setStreaming(false)
    }
  }
```

- [ ] **Step 3: Add the sidebar entry**

In `apps/web/src/components/dashboard/Sidebar.tsx`, add a Copilot link between Inbox and Knowledge, using the same icon/label pattern as the existing entries (`MessagesSquare` from `lucide-react` is unused elsewhere and fits).

- [ ] **Step 4: Typecheck and verify in the browser**

```bash
pnpm typecheck
pnpm dev
```

Open `/dashboard/copilot` and confirm: the agent picker lists your agents; sending a first message creates a thread and streams a reply; the thread appears in the list; reloading shows its history; source chips appear when the agent's knowledge base matched; a second thread against a different agent stays separate.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sse.ts apps/web/src/app/dashboard/copilot apps/web/src/components/dashboard/Sidebar.tsx
git commit -m "feat(web): Copilot chat page"
```

---

### Task 10: Test button and documentation

**Files:**
- Modify: `apps/web/src/app/dashboard/agents/page.tsx` (Test button in the editor)
- Modify: `docs/architecture.md`
- Modify: `docs/deploy.md`

**Interfaces:**
- Consumes: the page from Task 9.
- Produces: no new code interfaces.

- [ ] **Step 1: Add the Test button**

In the agent editor block of `apps/web/src/app/dashboard/agents/page.tsx`, next to the existing "Manage knowledge" link, add:

```tsx
<Link href={`/dashboard/copilot?agent=${editor.id}`} className="btn btn-ghost" style={{ marginTop: 12, marginLeft: 8, borderRadius: 'var(--r-sm)', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
  <MessagesSquare size={14} /> Test agent
</Link>
```

adding `MessagesSquare` to the `lucide-react` import.

- [ ] **Step 2: Document the architecture**

In `docs/architecture.md`, add a **Copilot** subsection under Services covering: the per-user thread path and why the collection is named `threads` rather than `conversations` (the sweep's collection-group queries); the two orchestrators sharing four extracted modules; and the separate usage counter. Add `copilotUsers/` to the Firestore tree in the infrastructure diagram.

- [ ] **Step 3: Document deployment**

In `docs/deploy.md` §4d (Firestore), note that `firestore.rules` must be deployed **before** the web release, because the Copilot thread list reads Firestore directly from the browser and would otherwise be denied. No new environment variables and no new indexes — the thread list is a single-collection ordered query, which Firestore serves from its automatic single-field indexes.

- [ ] **Step 4: Full verification**

```bash
pnpm --filter @ayooda/shared build
pnpm typecheck
cd apps/api && bun test
cd ../../packages/shared && bun test
```

Expected: typecheck clean; every test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/agents/page.tsx docs/architecture.md docs/deploy.md
git commit -m "feat(web): Test-agent entry point; docs for Copilot"
```

---

## Verification checklist

- [ ] `pnpm typecheck` clean across all workspaces
- [ ] `cd apps/api && bun test` — all pass, **with no pre-existing test file edited** (the refactor's core guarantee)
- [ ] `cd packages/shared && bun test` — all pass
- [ ] An existing widget conversation still works end to end (the extraction touched its path)
- [ ] A Copilot thread does **not** appear in `/dashboard/inbox`
- [ ] A Copilot thread is **not** auto-closed or scored by `POST /internal/sweep`
- [ ] A second workspace member cannot read the first member's threads (sign in as each and check the thread list)
- [ ] Sending on a workspace over `copilotCap` returns 402 with the internal-limit wording, and customer conversations still work
