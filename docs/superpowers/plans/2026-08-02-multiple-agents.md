# Multiple Agents Per Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single per-workspace agent into N agents, each owning its identity, system prompt, model, OpenRouter key, knowledge (own Pinecone namespace), and tools; each channel routes to a chosen agent.

**Architecture:** Agents become `workspaces/{id}/agents/{agentId}` docs; knowledge and tools are reparented under each agent. The agent doc stores its own Pinecone namespace string (migrated default keeps `ws_{workspaceId}` — no re-embedding). `prepareTurn` resolves the agent from `channel.agentId` (default fallback) and uses that agent's prompt/model/key/namespace/tools. An idempotent migration creates the default agent and reparents existing data.

**Tech Stack:** Bun + Hono (api), Firestore Admin SDK, Pinecone, Node scraper (Cloud Run Job / local spawn), `@ayooda/shared`, Next.js App Router client pages. Tests: `bun test`.

## Global Constraints

- **Per-agent everything:** identity, `systemPrompt`, `llmModel`, `openRouterKey`, knowledge, tools all live on/under the agent. Billing/usage stays **workspace-level, unchanged**.
- **Namespaces:** migrated **default agent keeps `ws_{workspaceId}`**; **new agents get `ws_{workspaceId}_ag_{agentId}`**. The namespace string is stored on the agent doc and is the single source of truth.
- **Secrets:** per-agent `openRouterKey` is AES-256-GCM (existing `crypto.ts`), server-only, **never returned** (responses carry `hasOpenRouterKey`).
- **Default agent:** exactly one `isDefault:true` per workspace. Delete guards: default → 400, last agent → 400, agent with channels attached → 409.
- **Routes:** all `/agents*` and agent-scoped knowledge/tools are owner-only (`requireAuth` + `requireOwner`). `requireAgent` additionally 404s when `:agentId` is not in the caller's workspace.
- **Visitor safety:** stale/missing `channel.agentId` → default agent; no agents at all → inline `workspace.agent` fallback. Agent resolution never hard-fails a visitor.
- **Web caution:** `apps/web/AGENTS.md` — modified Next.js; all pages mirror the existing client-page idiom (`'use client'` + `apiRequest`, inline styles), no new framework APIs.
- **Backward-compat during rollout:** scraper accepts new env optionally (defaults preserve old behavior); `GET /workspace` keeps returning `agent` (sourced from the default agent).

---

### Task 1: Shared agent types

**Files:**
- Modify: `packages/shared/src/index.ts` (append)

**Interfaces:**
- Produces: `AgentDoc`, `AgentSummary`.

- [ ] **Step 1: Add types**

Append to `packages/shared/src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// Agents (multiple per workspace)
// ---------------------------------------------------------------------------

/** The agent as returned by /agents — never carries the key or namespace. */
export interface AgentDoc {
  id: string
  name: string
  photoURL: string | null
  description: string
  systemPrompt: string
  llmModel: string
  hasOpenRouterKey: boolean
  isDefault: boolean
}

/** Compact shape for pickers/lists. */
export interface AgentSummary {
  id: string
  name: string
  photoURL: string | null
  llmModel: string
  isDefault: boolean
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @ayooda/shared typecheck && pnpm --filter @ayooda/shared build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): agent types (AgentDoc, AgentSummary)"
```

---

### Task 2: Agent helpers (pure)

**Files:**
- Create: `apps/api/src/lib/agents/agent-helpers.ts`
- Test: `apps/api/src/lib/agents/agent-helpers.test.ts`

**Interfaces:**
- Produces: `agentNamespace(workspaceId, agentId): string`; `resolveAgentDoc<T>(agentId: string | undefined, byId: Map<string,T>, defaultAgent: T | undefined): T | undefined`; `agentDeleteGuard(input): { ok: true } | { ok: false; status: 400 | 409; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/agents/agent-helpers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { agentNamespace, resolveAgentDoc, agentDeleteGuard } from './agent-helpers'

describe('agentNamespace', () => {
  test('builds a per-agent namespace', () => {
    expect(agentNamespace('WS1', 'AG1')).toBe('ws_WS1_ag_AG1')
  })
})

describe('resolveAgentDoc', () => {
  const byId = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]])
  const def = { id: 'a' }
  test('returns the agent for an explicit id', () => {
    expect(resolveAgentDoc('b', byId, def)).toEqual({ id: 'b' })
  })
  test('falls back to default when id is missing', () => {
    expect(resolveAgentDoc(undefined, byId, def)).toEqual({ id: 'a' })
  })
  test('falls back to default when the id is unknown', () => {
    expect(resolveAgentDoc('zzz', byId, def)).toEqual({ id: 'a' })
  })
})

describe('agentDeleteGuard', () => {
  test('blocks the default agent (400)', () => {
    expect(agentDeleteGuard({ isDefault: true, isLast: false, attachedChannels: [] })).toEqual({ ok: false, status: 400, error: 'Cannot delete the default agent. Set another agent as default first.' })
  })
  test('blocks the last agent (400)', () => {
    expect(agentDeleteGuard({ isDefault: false, isLast: true, attachedChannels: [] })).toEqual({ ok: false, status: 400, error: 'Cannot delete the only agent.' })
  })
  test('blocks when channels are attached (409)', () => {
    const r = agentDeleteGuard({ isDefault: false, isLast: false, attachedChannels: ['Website', 'Telegram'] })
    expect(r).toEqual({ ok: false, status: 409, error: 'Reassign these channels to another agent first: Website, Telegram' })
  })
  test('allows an otherwise-deletable agent', () => {
    expect(agentDeleteGuard({ isDefault: false, isLast: false, attachedChannels: [] })).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/agents/agent-helpers.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/agents/agent-helpers.ts`:

```ts
/** Pinecone namespace for a freshly-created agent. Migrated default agents keep "ws_{workspaceId}". */
export function agentNamespace(workspaceId: string, agentId: string): string {
  return `ws_${workspaceId}_ag_${agentId}`
}

/** Pick the agent for a turn: the explicit id if known, else the default. */
export function resolveAgentDoc<T>(
  agentId: string | undefined,
  byId: Map<string, T>,
  defaultAgent: T | undefined,
): T | undefined {
  if (agentId) {
    const found = byId.get(agentId)
    if (found) return found
  }
  return defaultAgent
}

export function agentDeleteGuard(input: {
  isDefault: boolean
  isLast: boolean
  attachedChannels: string[]
}): { ok: true } | { ok: false; status: 400 | 409; error: string } {
  if (input.isDefault) return { ok: false, status: 400, error: 'Cannot delete the default agent. Set another agent as default first.' }
  if (input.isLast) return { ok: false, status: 400, error: 'Cannot delete the only agent.' }
  if (input.attachedChannels.length > 0) return { ok: false, status: 409, error: `Reassign these channels to another agent first: ${input.attachedChannels.join(', ')}` }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/agents/agent-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agents/agent-helpers.ts apps/api/src/lib/agents/agent-helpers.test.ts
git commit -m "feat(api): pure agent helpers (namespace, resolve, delete-guard)"
```

---

### Task 3: `namespaceFor` takes a namespace string

**Files:**
- Modify: `apps/api/src/lib/pinecone.ts:16-19`
- Modify: `apps/api/src/lib/chat/agent-turn.ts:125` (caller)
- Modify: `apps/api/src/routes/knowledge.ts:126,170` (callers)

**Interfaces:**
- Produces: `namespaceFor(namespace: string)` — uses the string directly (no `ws_` prefixing).
- Consumes: nothing.

This is a behavior-neutral refactor: callers pass `ws_${workspaceId}` so RAG/delete keep hitting the same namespace. Later tasks switch them to the agent namespace.

- [ ] **Step 1: Change the signature**

In `apps/api/src/lib/pinecone.ts` replace:

```ts
/** Namespace per workspace to keep vectors isolated */
export function namespaceFor(workspaceId: string) {
  return getIndex().namespace(`ws_${workspaceId}`)
}
```

with:

```ts
/** Namespace for a Pinecone-isolated vector set. Pass the full namespace string
 * (e.g. an agent's stored knowledgeNamespace). */
export function namespaceFor(namespace: string) {
  return getIndex().namespace(namespace)
}
```

- [ ] **Step 2: Update the three callers (neutral)**

In `apps/api/src/lib/chat/agent-turn.ts` line ~125, change `namespaceFor(workspaceId)` to:

```ts
    const results = await namespaceFor(`ws_${workspaceId}`).query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
```

In `apps/api/src/routes/knowledge.ts` (both `deleteMany` sites, ~126 and ~170), change `namespaceFor(workspaceId)` to `namespaceFor(\`ws_${workspaceId}\`)`.

- [ ] **Step 3: Typecheck + full api tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun test`
Expected: PASS (behavior unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/pinecone.ts apps/api/src/lib/chat/agent-turn.ts apps/api/src/routes/knowledge.ts
git commit -m "refactor(api): namespaceFor takes a namespace string"
```

---

### Task 4: Scraper — per-agent namespace (backward-compatible)

**Files:**
- Modify: `apps/api/src/lib/scraper.ts` (`IngestionJobParams`, both env builders)
- Modify: `apps/scraper/src/index.ts` (`main`, `upsertVectors`)

**Interfaces:**
- Produces: `triggerIngestion` accepts optional `agentId?: string` and `namespace?: string`; when present they become `AGENT_ID` / `PINECONE_NAMESPACE` env. Scraper reads them, defaulting `PINECONE_NAMESPACE` to `ws_{WORKSPACE_ID}` and the doc path to workspace-level when `AGENT_ID` is absent.

- [ ] **Step 1: Extend `triggerIngestion`**

In `apps/api/src/lib/scraper.ts`, update the interface:

```ts
interface IngestionJobParams {
  workspaceId: string
  docId: string
  docType: 'webpage' | 'file'
  url?: string
  storagePath?: string
  agentId?: string
  namespace?: string
}
```

In `triggerCloudRunJob`, add to `jobEnv`:

```ts
    ...(params.agentId ? [{ name: 'AGENT_ID', value: params.agentId }] : []),
    ...(params.namespace ? [{ name: 'PINECONE_NAMESPACE', value: params.namespace }] : []),
```

In `triggerLocal`'s `env` object, add:

```ts
    ...(params.agentId ? { AGENT_ID: params.agentId } : {}),
    ...(params.namespace ? { PINECONE_NAMESPACE: params.namespace } : {}),
```

- [ ] **Step 2: Update the scraper to read the new env**

In `apps/scraper/src/index.ts` `main()`, after reading `storagePath`:

```ts
  const agentId = process.env.AGENT_ID
  const namespace = process.env.PINECONE_NAMESPACE ?? `ws_${workspaceId}`
```

Change the doc ref to be agent-scoped when `agentId` is set:

```ts
  const docRef = agentId
    ? db.doc(`workspaces/${workspaceId}/agents/${agentId}/knowledge/${docId}`)
    : db.doc(`workspaces/${workspaceId}/knowledge/${docId}`)
```

Change the `upsertVectors` call to pass `namespace` and `agentId`:

```ts
    await upsertVectors(pinecone, namespace, workspaceId, agentId, docId, source, allChunks, embeddings)
```

Update `upsertVectors`:

```ts
async function upsertVectors(
  pinecone: Pinecone,
  namespace: string,
  workspaceId: string,
  agentId: string | undefined,
  docId: string,
  source: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  const ns = pinecone.index(process.env.PINECONE_INDEX!).namespace(namespace)

  const vectors = chunks.map((text, i) => ({
    id: `${docId}_${i}`,
    values: embeddings[i],
    metadata: { workspaceId, ...(agentId ? { agentId } : {}), docId, source, chunkIndex: i, text },
  }))

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await ns.upsert(vectors.slice(i, i + UPSERT_BATCH))
  }
}
```

- [ ] **Step 3: Typecheck both packages**

Run: `pnpm --filter api typecheck && pnpm --filter scraper typecheck`
Expected: PASS. (Callers still omit `agentId`/`namespace`, so behavior is unchanged until Task 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/scraper.ts apps/scraper/src/index.ts
git commit -m "feat(scraper): per-agent namespace + agent-scoped doc path (backward-compatible)"
```

---

### Task 5: Seed a default agent on workspace creation

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (first-login batch)

**Interfaces:**
- Produces: new workspaces get `workspaces/{id}/agents/{defaultId}` with `isDefault:true`, `knowledgeNamespace: "ws_{workspaceId}"`. The inline `workspace.agent` is kept as a back-compat copy.

- [ ] **Step 1: Create the default agent doc in the seed batch**

In `apps/api/src/routes/auth.ts`, after `const workspaceId = workspaceRef.id` and before `batch.set(workspaceRef, {...})`, add:

```ts
  const defaultAgentRef = workspaceRef.collection('agents').doc()
  const defaultAgent = {
    name: 'Support Agent',
    photoURL: null,
    description: '',
    systemPrompt: 'You are a helpful customer support agent. Answer questions based on the provided context.',
    llmModel: 'google/gemini-2.5-flash',
    knowledgeNamespace: `ws_${workspaceId}`,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }
```

Then inside the batch, after `batch.set(workspaceRef, {...})`, add:

```ts
  batch.set(defaultAgentRef, defaultAgent)
```

(The inline `agent: {...}` field on the workspace doc stays for back-compat.)

- [ ] **Step 2: Typecheck + smoke the module**

Run: `cd apps/api && pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/auth.ts
git commit -m "feat(api): seed a default agent doc on workspace creation"
```

---

### Task 6: `/agents` route (CRUD + key + default + delete-with-purge)

**Files:**
- Create: `apps/api/src/routes/agents.ts`
- Modify: `apps/api/src/index.ts` (mount `/agents`)

**Interfaces:**
- Consumes: `agentNamespace`, `agentDeleteGuard` (Task 2); `namespaceFor` (Task 3); `encryptSecret` (`../lib/crypto`); `LLM_MODELS`, `AgentDoc` (`@ayooda/shared`); `adminDb`, `adminBucket`.
- Produces: a Hono router at `/agents`.

- [ ] **Step 1: Implement the route**

Create `apps/api/src/routes/agents.ts`:

```ts
import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb, adminBucket } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { encryptSecret } from '../lib/crypto'
import { namespaceFor } from '../lib/pinecone'
import { agentNamespace, agentDeleteGuard } from '../lib/agents/agent-helpers'
import { LLM_MODELS, type AgentDoc } from '@ayooda/shared'

const agents = new Hono<{ Variables: AuthVariables }>()
agents.use('*', requireAuth)
agents.use('*', requireOwner)

const DEFAULT_PROMPT = 'You are a helpful customer support agent. Answer questions based on the provided context.'
const DEFAULT_MODEL = 'google/gemini-2.5-flash'

function toAgentDoc(id: string, d: DocumentData): AgentDoc {
  return {
    id,
    name: d.name,
    photoURL: d.photoURL ?? null,
    description: d.description ?? '',
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
    hasOpenRouterKey: Boolean(d.openRouterKey),
    isDefault: d.isDefault === true,
  }
}

/** GET /agents — list (default first, then newest). */
agents.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/agents`).get()
  const list = snap.docs.map((d) => toAgentDoc(d.id, d.data()))
  list.sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))
  return c.json({ agents: list })
})

/** POST /agents — create a non-default agent with a fresh namespace. */
agents.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const body = await c.req.json<{ name?: string; description?: string; systemPrompt?: string; llmModel?: string }>().catch(() => ({}))
  const name = body.name?.trim()
  if (!name || name.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400)
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)

  const ref = adminDb.collection(`workspaces/${ws}/agents`).doc()
  const now = new Date()
  const doc = {
    name,
    photoURL: null,
    description: body.description?.trim() ?? '',
    systemPrompt: body.systemPrompt?.trim() || DEFAULT_PROMPT,
    llmModel: body.llmModel ?? DEFAULT_MODEL,
    knowledgeNamespace: agentNamespace(ws, ref.id),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }
  await ref.set(doc)
  return c.json(toAgentDoc(ref.id, doc))
})

/** GET /agents/:id */
agents.get('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  return c.json(toAgentDoc(snap.id, snap.data()!))
})

/** PUT /agents/:id — update identity/prompt/model. */
agents.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const body = await c.req.json<{ name?: string; photoURL?: string | null; description?: string; systemPrompt?: string; llmModel?: string }>().catch(() => ({}))
  if (body.llmModel !== undefined && !LLM_MODELS.some((m) => m.id === body.llmModel)) return c.json({ error: 'Invalid llmModel' }, 400)

  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name !== undefined) { const n = body.name.trim(); if (!n || n.length > 80) return c.json({ error: 'name is required (max 80 chars)' }, 400); update.name = n }
  if (body.photoURL !== undefined) update.photoURL = body.photoURL
  if (body.description !== undefined) update.description = body.description
  if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt
  if (body.llmModel !== undefined) update.llmModel = body.llmModel

  await ref.update(update)
  const after = await ref.get()
  return c.json(toAgentDoc(after.id, after.data()!))
})

/** PUT /agents/:id/key — store the agent's OpenRouter key (encrypted). */
agents.put('/:id/key', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)
  const body = await c.req.json<{ apiKey?: string }>().catch(() => ({}))
  const apiKey = body.apiKey?.trim()
  if (!apiKey || apiKey.length > 500) return c.json({ error: 'apiKey is required (max 500 chars)' }, 400)
  await ref.update({ openRouterKey: encryptSecret(apiKey), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** DELETE /agents/:id/key */
agents.delete('/:id/key', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Agent not found' }, 404)
  const { FieldValue } = await import('firebase-admin/firestore')
  await ref.update({ openRouterKey: FieldValue.delete(), updatedAt: new Date() })
  return c.json({ ok: true })
})

/** POST /agents/:id/default — make this the workspace default. */
agents.post('/:id/default', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const col = adminDb.collection(`workspaces/${ws}/agents`)
  const target = await col.doc(id).get()
  if (!target.exists) return c.json({ error: 'Agent not found' }, 404)
  const all = await col.where('isDefault', '==', true).get()
  const batch = adminDb.batch()
  all.docs.forEach((d) => { if (d.id !== id) batch.update(d.ref, { isDefault: false }) })
  batch.update(col.doc(id), { isDefault: true, updatedAt: new Date() })
  await batch.commit()
  return c.json({ ok: true })
})

/** DELETE /agents/:id — guarded; purges namespace, knowledge (+ files), tools. */
agents.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const id = c.req.param('id')
  const ref = adminDb.doc(`workspaces/${ws}/agents/${id}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  const data = snap.data()!

  const [countSnap, channelsSnap] = await Promise.all([
    adminDb.collection(`workspaces/${ws}/agents`).count().get(),
    adminDb.collection(`workspaces/${ws}/channels`).where('agentId', '==', id).get(),
  ])
  const attachedChannels = channelsSnap.docs.map((d) => {
    const ch = d.data()
    return ch.type === 'telegram' ? 'Telegram' : ch.type === 'web_widget' ? 'Website' : (ch.type ?? d.id)
  })
  const guard = agentDeleteGuard({
    isDefault: data.isDefault === true,
    isLast: countSnap.data().count <= 1,
    attachedChannels,
  })
  if (!guard.ok) return c.json({ error: guard.error }, guard.status)

  // Purge vectors (best-effort)
  try { await namespaceFor(data.knowledgeNamespace ?? `ws_${ws}_ag_${id}`).deleteAll() } catch (err) { console.warn('[agents] namespace purge failed:', err) }

  // Delete knowledge docs + their storage files
  const knowledgeSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/knowledge`).get()
  for (const d of knowledgeSnap.docs) {
    const sp = d.data().storagePath as string | undefined
    if (sp) { try { await adminBucket().file(sp).delete() } catch (err) { console.warn('[agents] storage delete failed:', err) } }
    await d.ref.delete()
  }

  // Delete tools
  const toolsSnap = await adminDb.collection(`workspaces/${ws}/agents/${id}/tools`).get()
  for (const d of toolsSnap.docs) await d.ref.delete()

  await ref.delete()
  return c.json({ ok: true })
})

export default agents
```

- [ ] **Step 2: Mount in index.ts**

In `apps/api/src/index.ts`, add `import agentRoutes from './routes/agents'` with the other imports, and mount it before the widget/telegram block:

```ts
app.route('/agents', agentRoutes)
```

- [ ] **Step 3: Typecheck + build + mount check**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && grep -n "agentRoutes" src/index.ts`
Expected: PASS; two `agentRoutes` matches.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/agents.ts apps/api/src/index.ts
git commit -m "feat(api): /agents CRUD + per-agent key + default + delete-with-purge"
```

---

### Task 7: Agent-scoped knowledge route (+ `requireAgent`)

**Files:**
- Create: `apps/api/src/middleware/agent.ts`
- Modify: `apps/api/src/middleware/auth.ts` (extend `AuthVariables`)
- Modify: `apps/api/src/routes/knowledge.ts` (use `requireAgent`, agent paths, namespace, triggerIngestion args)
- Modify: `apps/api/src/index.ts` (remount knowledge under `/agents/:agentId/knowledge`)

**Interfaces:**
- Consumes: `adminDb`; `AuthVariables`.
- Produces: `requireAgent` middleware — validates `:agentId` is in the caller's workspace, sets `c.set('agentId', id)` and `c.set('agentNamespace', ns)`; 404 otherwise. `AuthVariables` gains `agentId?: string`, `agentNamespace?: string`.

- [ ] **Step 1: Extend `AuthVariables`**

In `apps/api/src/middleware/auth.ts`, update the type:

```ts
export type AuthVariables = {
  uid: string
  workspaceId: string
  role: WorkspaceRole
  agentId?: string
  agentNamespace?: string
}
```

- [ ] **Step 2: Create `requireAgent`**

Create `apps/api/src/middleware/agent.ts`:

```ts
import { createMiddleware } from 'hono/factory'
import { adminDb } from '../lib/firebase-admin'
import type { AuthVariables } from './auth'

/** Loads workspaces/{ws}/agents/{agentId}; 404 if not in the caller's workspace.
 * Sets agentId + agentNamespace. Run AFTER requireAuth (+ requireOwner). */
export const requireAgent = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const ws = c.get('workspaceId')
  const agentId = c.req.param('agentId')
  if (!agentId) return c.json({ error: 'Agent not found' }, 404)
  const snap = await adminDb.doc(`workspaces/${ws}/agents/${agentId}`).get()
  if (!snap.exists) return c.json({ error: 'Agent not found' }, 404)
  c.set('agentId', agentId)
  c.set('agentNamespace', (snap.data()!.knowledgeNamespace as string) ?? `ws_${ws}`)
  await next()
})
```

- [ ] **Step 3: Make knowledge.ts agent-scoped**

In `apps/api/src/routes/knowledge.ts`:

Add the import and middleware registration (after the existing `knowledge.use('*', requireOwner)`):

```ts
import { requireAgent } from '../middleware/agent'
...
knowledge.use('*', requireAgent)
```

Replace every `workspaces/${workspaceId}/knowledge` collection/doc path with `workspaces/${workspaceId}/agents/${agentId}/knowledge`, where `agentId` comes from `const agentId = c.get('agentId')!` at the top of each handler.

Replace both `namespaceFor(\`ws_${workspaceId}\`)` calls (delete + reindex) with `namespaceFor(c.get('agentNamespace')!)`.

Change the storage path in `/upload` from `workspaces/${workspaceId}/knowledge/${docRef.id}/${file.name}` to `workspaces/${workspaceId}/agents/${agentId}/knowledge/${docRef.id}/${file.name}`.

Pass agent context to every `triggerIngestion(...)` call by adding `agentId` and `namespace: c.get('agentNamespace')!`. Example for `/scrape`:

```ts
  triggerIngestion({ workspaceId, docId: docRef.id, docType: 'webpage', url: normalised, agentId, namespace: c.get('agentNamespace')! })
```

Apply the same two added fields to the `/upload` and `/:id/reindex` `triggerIngestion` calls.

- [ ] **Step 4: Remount in index.ts**

In `apps/api/src/index.ts`, change `app.route('/knowledge', knowledgeRoutes)` to:

```ts
app.route('/agents/:agentId/knowledge', knowledgeRoutes)
```

- [ ] **Step 5: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/agent.ts apps/api/src/middleware/auth.ts apps/api/src/routes/knowledge.ts apps/api/src/index.ts
git commit -m "feat(api): agent-scoped knowledge route + requireAgent middleware"
```

---

### Task 8: Agent-scoped tools route

**Files:**
- Modify: `apps/api/src/routes/tools.ts` (use `requireAgent`, agent tool paths)
- Modify: `apps/api/src/index.ts` (remount under `/agents/:agentId/tools`)

**Interfaces:**
- Consumes: `requireAgent` (Task 7).
- Produces: tools CRUD/test operating on `workspaces/{ws}/agents/{agentId}/tools`.

- [ ] **Step 1: Make tools.ts agent-scoped**

In `apps/api/src/routes/tools.ts`:

Add `import { requireAgent } from '../middleware/agent'` and register it after `tools.use('*', requireOwner)`:

```ts
tools.use('*', requireAgent)
```

Add `const agentId = c.get('agentId')!` at the top of each handler and replace every `workspaces/${ws}/tools` path with `workspaces/${ws}/agents/${agentId}/tools`.

- [ ] **Step 2: Remount in index.ts**

Change `app.route('/tools', toolRoutes)` to:

```ts
app.route('/agents/:agentId/tools', toolRoutes)
```

- [ ] **Step 3: Typecheck + build + full api tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && bun test`
Expected: PASS (tool unit tests for pure helpers/executor are unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/tools.ts apps/api/src/index.ts
git commit -m "feat(api): agent-scoped tools route"
```

---

### Task 9: Agent resolution in `prepareTurn` + `loadTools(ws, agentId)`

**Files:**
- Modify: `apps/api/src/lib/chat/tools.ts` (`loadTools` signature)
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (resolve agent; use its prompt/model/key/namespace/tools)
- Modify: `apps/api/src/routes/widget.ts` (pass `agentId`)
- Modify: `apps/api/src/routes/telegram.ts` (pass `agentId`)

**Interfaces:**
- Consumes: `resolveAgentDoc` (Task 2); `namespaceFor` (Task 3); `loadTools(workspaceId, agentId)`.
- Produces: `PrepareTurnInput` gains `agentId?: string`. `loadTools(workspaceId: string, agentId: string)`.

- [ ] **Step 1: Change `loadTools` signature**

In `apps/api/src/lib/chat/tools.ts`, update:

```ts
export async function loadTools(workspaceId: string, agentId: string): Promise<StoredTool[]> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/agents/${agentId}/tools`).where('enabled', '==', true).get()
  const tools = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoredTool, 'id'>) }))
  return selectExposedTools(tools)
}
```

- [ ] **Step 2: Resolve the agent in `prepareTurn`**

In `apps/api/src/lib/chat/agent-turn.ts`:

Add `agentId?: string` to `PrepareTurnInput`:

```ts
export interface PrepareTurnInput {
  workspaceId: string
  channelId: string
  conversationId: string
  visitorId: string
  message: string
  channelType: ChannelType
  telegramChatId?: number
  agentId?: string
}
```

Add the import:

```ts
import { resolveAgentDoc } from '../agents/agent-helpers'
```

Destructure `agentId` from `input`, then replace the current agent read:

```ts
  const agent = workspaceData.agent
  const systemPrompt: string = agent.systemPrompt
  const storedModel: string = agent.llmModel ?? 'gemini-flash-latest'
```

with an agent-doc resolution that falls back to the inline agent:

```ts
  // Resolve the agent for this turn: the channel's agent, else the workspace default,
  // else the inline workspace.agent (pre-migration safety net).
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  let agentRec: { id: string; systemPrompt: string; llmModel: string; openRouterKey?: string; knowledgeNamespace: string } | undefined
  try {
    const byId = new Map<string, typeof agentRec>()
    let defaultAgent: typeof agentRec
    const [specificSnap, defaultSnap] = await Promise.all([
      agentId ? agentsCol.doc(agentId).get() : Promise.resolve(null),
      agentsCol.where('isDefault', '==', true).limit(1).get(),
    ])
    const toRec = (id: string, d: FirebaseFirestore.DocumentData): NonNullable<typeof agentRec> => ({
      id,
      systemPrompt: d.systemPrompt ?? '',
      llmModel: d.llmModel ?? 'google/gemini-2.5-flash',
      openRouterKey: d.openRouterKey,
      knowledgeNamespace: d.knowledgeNamespace ?? `ws_${workspaceId}`,
    })
    if (specificSnap && specificSnap.exists) { const r = toRec(specificSnap.id, specificSnap.data()!); byId.set(r.id, r) }
    if (!defaultSnap.empty) { const d = defaultSnap.docs[0]!; defaultAgent = toRec(d.id, d.data()!) }
    agentRec = resolveAgentDoc(agentId, byId, defaultAgent)
  } catch (err) {
    console.warn('[agent-turn] agent resolution failed:', err)
  }
  if (!agentRec) {
    const inline = workspaceData.agent ?? {}
    agentRec = {
      id: 'inline',
      systemPrompt: inline.systemPrompt ?? '',
      llmModel: inline.llmModel ?? 'google/gemini-2.5-flash',
      openRouterKey: workspaceData.openRouterKey,
      knowledgeNamespace: `ws_${workspaceId}`,
    }
  }
  const systemPrompt: string = agentRec.systemPrompt
  const storedModel: string = agentRec.llmModel ?? 'gemini-flash-latest'
```

Update the RAG query to the agent's namespace (was `namespaceFor(\`ws_${workspaceId}\`)`):

```ts
    const results = await namespaceFor(agentRec.knowledgeNamespace).query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
```

Update key resolution to use the agent's key (was `workspaceData.openRouterKey`):

```ts
    keyResult = resolveOpenRouterKey(provider, agentRec.openRouterKey)
```

Update the tools load (was `loadTools(workspaceId)`):

```ts
    tools = await loadTools(workspaceId, agentRec.id)
```

- [ ] **Step 3: Pass `agentId` from both channels**

In `apps/api/src/routes/widget.ts`, in the `prepareTurn({...})` call, add:

```ts
    agentId: channelDoc.data().agentId,
```

In `apps/api/src/routes/telegram.ts`, in the `prepareTurn({...})` call, add:

```ts
        agentId: channel.agentId,
```

- [ ] **Step 4: Typecheck + build + full api tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/chat/tools.ts apps/api/src/lib/chat/agent-turn.ts apps/api/src/routes/widget.ts apps/api/src/routes/telegram.ts
git commit -m "feat(api): prepareTurn resolves the channel's agent (prompt/model/key/namespace/tools)"
```

---

### Task 10: Channels ↔ agent assignment

**Files:**
- Modify: `apps/api/src/routes/channels.ts` (agentId on create; `PUT /channels/:id/agent`; read default agent for cached config)

**Interfaces:**
- Consumes: `adminDb`.
- Produces: `channel.agentId` set on create; `PUT /channels/:id/agent { agentId }` reassigns and refreshes cached `agentName`/`agentPhotoURL`.

- [ ] **Step 1: Add a default-agent helper + set agentId on web-widget create**

In `apps/api/src/routes/channels.ts`, add near the top (after the constants):

```ts
async function defaultAgent(workspaceId: string): Promise<{ id: string; name: string; photoURL: string | null } | null> {
  const snap = await adminDb.collection(`workspaces/${workspaceId}/agents`).where('isDefault', '==', true).limit(1).get()
  if (snap.empty) return null
  const d = snap.docs[0]!
  return { id: d.id, name: d.data().name ?? 'Support Agent', photoURL: d.data().photoURL ?? null }
}
```

In `POST /channels/web-widget`, replace the agent-name lookup:

```ts
  const agent = await defaultAgent(workspaceId)
  const agentName = agent?.name ?? workspaceSnap.data()?.agent?.name ?? 'Support Agent'
  const agentPhotoURL = agent?.photoURL ?? workspaceSnap.data()?.agent?.photoURL ?? null
```

and add `agentId: agent?.id ?? null` to the `batch.set(channelRef, {...})` payload.

- [ ] **Step 2: Set agentId on telegram create**

In `POST /channels/telegram`, before `await channelRef.set({...})`, add `const agent = await defaultAgent(workspaceId)` and include `agentId: agent?.id ?? null` in the channel doc.

- [ ] **Step 3: Add the reassignment endpoint**

Add to `apps/api/src/routes/channels.ts` (before `export default channels`):

```ts
/** PUT /channels/:id/agent — assign which agent answers on this channel. */
channels.put('/:id/agent', async (c) => {
  const workspaceId = c.get('workspaceId')
  const channelId = c.req.param('id')
  const body = await c.req.json<{ agentId?: string }>().catch(() => ({}))
  const agentId = body.agentId
  if (!agentId) return c.json({ error: 'agentId is required' }, 400)

  const agentSnap = await adminDb.doc(`workspaces/${workspaceId}/agents/${agentId}`).get()
  if (!agentSnap.exists) return c.json({ error: 'Agent not found' }, 404)
  const channelRef = adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`)
  const channelSnap = await channelRef.get()
  if (!channelSnap.exists) return c.json({ error: 'Channel not found' }, 404)

  const a = agentSnap.data()!
  const update: Record<string, unknown> = { agentId }
  // Refresh the cached widget identity so the visitor sees the assigned agent.
  if (channelSnap.data()!.type === 'web_widget') {
    update['config.agentName'] = a.name ?? 'Support Agent'
    update['config.agentPhotoURL'] = a.photoURL ?? null
  }
  await channelRef.update(update)
  return c.json({ ok: true })
})
```

- [ ] **Step 4: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/channels.ts
git commit -m "feat(api): assign an agent per channel (create default + PUT /channels/:id/agent)"
```

---

### Task 11: Retire workspace-level agent/key routes; GET /workspace back-compat

**Files:**
- Modify: `apps/api/src/routes/workspace.ts` (remove `PUT /workspace/agent`, `PUT/DELETE /workspace/key`; GET returns default agent as `agent`)

**Interfaces:**
- Consumes: `adminDb`.
- Produces: `GET /workspace` returns `agent` sourced from the default agent (fallback inline) and `hasOpenRouterKey` from the default agent; the workspace agent/key mutation endpoints are gone (moved to `/agents`).

- [ ] **Step 1: Source `agent` from the default agent in GET /workspace**

In `apps/api/src/routes/workspace.ts` `GET /`, after loading `data`, resolve the default agent:

```ts
  const agentsSnap = await adminDb.collection(`workspaces/${workspaceId}/agents`).where('isDefault', '==', true).limit(1).get()
  const defAgent = agentsSnap.empty ? null : agentsSnap.docs[0]!.data()
  const agentSource = defAgent ?? data.agent ?? {}
```

Replace the returned `agent` object and `hasOpenRouterKey`:

```ts
    agent: {
      name: agentSource.name,
      photoURL: agentSource.photoURL ?? null,
      description: agentSource.description ?? '',
      systemPrompt: agentSource.systemPrompt ?? '',
      llmModel: LEGACY_MODEL_MAP[agentSource.llmModel] ?? agentSource.llmModel,
    },
    usage: data.usage,
    hasOpenRouterKey: Boolean(defAgent ? defAgent.openRouterKey : data.openRouterKey),
    role: c.get('role'),
```

- [ ] **Step 2: Remove the moved endpoints**

Delete the `PUT /workspace/agent` handler and the `PUT /workspace/key` + `DELETE /workspace/key` handlers from `workspace.ts`. Remove the now-unused imports (`encryptSecret`, `FieldValue`, `LLM_MODELS`) if no longer referenced. Keep `PUT /workspace` (rename) and the `LEGACY_MODEL_MAP` import (still used by GET).

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS (no unused-import errors).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/workspace.ts
git commit -m "refactor(api): move agent/key mutations to /agents; GET /workspace reads default agent"
```

---

### Task 12: Migration script

**Files:**
- Create: `apps/api/scripts/migrate-agents.ts`

**Interfaces:**
- Consumes: `adminDb`.
- Produces: an idempotent script that, per workspace without an `agents` subcollection, creates the default agent and reparents knowledge + tools + sets `channel.agentId`.

- [ ] **Step 1: Write the script**

Create `apps/api/scripts/migrate-agents.ts`:

```ts
/**
 * One-time migration: create a default agent per workspace and reparent
 * knowledge + tools under it; tag channels with the default agent id.
 * Idempotent — skips workspaces that already have an `agents` subcollection.
 *
 * Run: bun run apps/api/scripts/migrate-agents.ts
 */
import { adminDb } from '../src/lib/firebase-admin'

async function migrateWorkspace(wsId: string, wsData: FirebaseFirestore.DocumentData): Promise<'skipped' | 'migrated'> {
  const agentsCol = adminDb.collection(`workspaces/${wsId}/agents`)
  const existing = await agentsCol.limit(1).get()
  if (!existing.empty) return 'skipped'

  const now = new Date()
  const inline = wsData.agent ?? {}
  const agentRef = agentsCol.doc()
  const agent: Record<string, unknown> = {
    name: inline.name ?? 'Support Agent',
    photoURL: inline.photoURL ?? null,
    description: inline.description ?? '',
    systemPrompt: inline.systemPrompt ?? 'You are a helpful customer support agent. Answer questions based on the provided context.',
    llmModel: inline.llmModel ?? 'google/gemini-2.5-flash',
    knowledgeNamespace: `ws_${wsId}`,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }
  if (wsData.openRouterKey) agent.openRouterKey = wsData.openRouterKey
  await agentRef.set(agent)

  // Reparent knowledge
  const knowledge = await adminDb.collection(`workspaces/${wsId}/knowledge`).get()
  for (const d of knowledge.docs) {
    await agentRef.collection('knowledge').doc(d.id).set(d.data())
    await d.ref.delete()
  }

  // Reparent tools
  const tools = await adminDb.collection(`workspaces/${wsId}/tools`).get()
  for (const d of tools.docs) {
    await agentRef.collection('tools').doc(d.id).set(d.data())
    await d.ref.delete()
  }

  // Tag channels
  const channels = await adminDb.collection(`workspaces/${wsId}/channels`).get()
  for (const d of channels.docs) await d.ref.update({ agentId: agentRef.id })

  return 'migrated'
}

async function main() {
  const workspaces = await adminDb.collection('workspaces').get()
  let migrated = 0, skipped = 0
  for (const ws of workspaces.docs) {
    const result = await migrateWorkspace(ws.id, ws.data())
    if (result === 'migrated') { migrated++; console.log(`[migrate] ${ws.id}: migrated`) }
    else { skipped++ }
  }
  console.log(`[migrate] done — migrated ${migrated}, skipped ${skipped}`)
  process.exit(0)
}

main().catch((err) => { console.error('[migrate] failed:', err); process.exit(1) })
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/api && pnpm --filter api typecheck`
Expected: PASS. (Not executed here — it mutates real data; run at deploy time.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/migrate-agents.ts
git commit -m "feat(api): idempotent migrate-agents script (default agent + reparent)"
```

---

### Task 13: Web — Sidebar rename + Agents page

**Files:**
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx` (label "Agent" → "Agents", href `/dashboard/agents`)
- Create: `apps/web/src/app/dashboard/agents/page.tsx`
- Delete: `apps/web/src/app/dashboard/agent/page.tsx`

**Interfaces:**
- Consumes: `apiRequest`; `/agents` endpoints; `AgentDoc`, `LLM_MODELS`, `providerOf` (`@ayooda/shared`).

- [ ] **Step 1: Rename the nav item**

In `apps/web/src/components/dashboard/Sidebar.tsx`, change the Agent nav entry:

```ts
  { label: 'Agents', href: '/dashboard/agents', icon: Bot },
```

- [ ] **Step 2: Create the Agents page**

Create `apps/web/src/app/dashboard/agents/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Trash2, Star } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { LLM_MODELS, providerOf, type AgentDoc } from '@ayooda/shared'

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

interface Editor { id: string; name: string; description: string; systemPrompt: string; llmModel: string; hasOpenRouterKey: boolean; isDefault: boolean; apiKey: string }

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/agents')
      if (res.ok) { const d = await res.json() as { agents: AgentDoc[] }; setAgents(d.agents) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  function edit(a: AgentDoc) {
    setEditor({ id: a.id, name: a.name, description: a.description, systemPrompt: a.systemPrompt, llmModel: a.llmModel, hasOpenRouterKey: a.hasOpenRouterKey, isDefault: a.isDefault, apiKey: '' })
    setError('')
  }

  async function create() {
    setCreating(true); setError('')
    try {
      const res = await apiRequest('/agents', { method: 'POST', body: JSON.stringify({ name: 'New agent' }) })
      const d = await res.json().catch(() => ({})) as AgentDoc & { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not create the agent'); return }
      await load(); edit(d)
    } finally { setCreating(false) }
  }

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    try {
      const res = await apiRequest(`/agents/${editor.id}`, { method: 'PUT', body: JSON.stringify({ name: editor.name.trim(), description: editor.description, systemPrompt: editor.systemPrompt, llmModel: editor.llmModel }) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the agent'); return }
      if (editor.apiKey.trim()) {
        await apiRequest(`/agents/${editor.id}/key`, { method: 'PUT', body: JSON.stringify({ apiKey: editor.apiKey.trim() }) })
      }
      setEditor(null); await load()
    } finally { setSaving(false) }
  }

  async function makeDefault(id: string) {
    setBusyId(id)
    try { await apiRequest(`/agents/${id}/default`, { method: 'POST' }); await load() } finally { setBusyId('') }
  }

  async function remove(id: string) {
    setBusyId(id); setError('')
    try {
      const res = await apiRequest(`/agents/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; setError(d.error ?? 'Could not delete the agent'); return }
      await load()
    } finally { setBusyId('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Agents</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Each agent has its own persona, model, key, knowledge, and tools. Channels pick which agent answers.</p>
        </div>
        {!editor && <button type="button" onClick={() => void create()} disabled={creating} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> {creating ? 'Creating…' : 'New agent'}</button>}
      </div>

      {error && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{error}</p>}

      {!editor && (
        <div style={card}>
          <p style={label}>Your agents</p>
          {agents.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{a.name} {a.isDefault && <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>· default</span>}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{a.llmModel}{a.hasOpenRouterKey ? ' · own key' : ''}</p>
              </div>
              {!a.isDefault && <button type="button" onClick={() => void makeDefault(a.id)} disabled={busyId === a.id} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 'var(--r-sm)', padding: '6px 10px', fontSize: 12 }}><Star size={13} /> Set default</button>}
              <button type="button" onClick={() => edit(a)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              {!a.isDefault && <button type="button" onClick={() => void remove(a.id)} disabled={busyId === a.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>{busyId === a.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}</button>}
            </div>
          ))}
        </div>
      )}

      {editor && (
        <div style={card}>
          <p style={label}>Edit agent</p>
          <div style={{ marginBottom: 12 }}><input placeholder="Agent name" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} style={input} /></div>
          <div style={{ marginBottom: 12 }}><input placeholder="Short description" value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} style={input} /></div>
          <div style={{ marginBottom: 12 }}><textarea placeholder="System prompt — the agent's personality and instructions" value={editor.systemPrompt} onChange={(e) => setEditor({ ...editor, systemPrompt: e.target.value })} style={{ ...input, minHeight: 100, resize: 'vertical' }} /></div>

          <p style={{ ...label, marginTop: 16 }}>Model</p>
          <select value={editor.llmModel} onChange={(e) => setEditor({ ...editor, llmModel: e.target.value })} style={input}>
            {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.description}</option>)}
          </select>
          {providerOf(editor.llmModel) !== 'gemini' && !editor.hasOpenRouterKey && !editor.apiKey && (
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 6 }}>This model needs an OpenRouter key (below).</p>
          )}

          <p style={{ ...label, marginTop: 16 }}>OpenRouter key</p>
          <input type="password" placeholder={editor.hasOpenRouterKey ? '•••• set (leave blank to keep)' : 'sk-or-…'} value={editor.apiKey} onChange={(e) => setEditor({ ...editor, apiKey: e.target.value })} style={input} />

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save agent'}</button>
            <button type="button" onClick={() => setEditor(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Delete the old agent page**

```bash
git rm apps/web/src/app/dashboard/agent/page.tsx
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS; `/dashboard/agents` present, `/dashboard/agent` gone.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/Sidebar.tsx apps/web/src/app/dashboard/agents/page.tsx
git commit -m "feat(web): Agents page (list/create/edit/default/delete) + nav rename"
```

---

### Task 14: Web — agent selector on the Knowledge page

**Files:**
- Modify: `apps/web/src/app/dashboard/knowledge/page.tsx`

**Interfaces:**
- Consumes: `/agents`, `/agents/:agentId/knowledge*`; `AgentSummary` (`@ayooda/shared`).

- [ ] **Step 1: Add an agents fetch + selector, and scope all knowledge calls**

In `apps/web/src/app/dashboard/knowledge/page.tsx`:

Add state near the top of the component:

```tsx
  const [agentList, setAgentList] = useState<{ id: string; name: string; isDefault: boolean }[]>([])
  const [agentId, setAgentId] = useState<string>('')
```

On mount, load agents and pick the default:

```tsx
  useEffect(() => {
    void (async () => {
      const res = await apiRequest('/agents')
      if (res.ok) {
        const d = await res.json() as { agents: { id: string; name: string; isDefault: boolean }[] }
        setAgentList(d.agents)
        setAgentId((prev) => prev || d.agents.find((a) => a.isDefault)?.id || d.agents[0]?.id || '')
      }
    })()
  }, [])
```

Change every knowledge fetch path from `/knowledge…` to `` `/agents/${agentId}/knowledge…` ``, and guard the existing load/effects so they only run once `agentId` is set (add `agentId` to the relevant dependency arrays and early-return when it is empty). Re-fetch the doc list when `agentId` changes.

Render a selector above the doc list (only when there is more than one agent):

```tsx
  {agentList.length > 1 && (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: 'var(--ink-mute)', marginRight: 8 }}>Agent</label>
      <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14 }}>
        {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}
      </select>
    </div>
  )}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/knowledge/page.tsx
git commit -m "feat(web): per-agent knowledge (agent selector, agent-scoped calls)"
```

---

### Task 15: Web — agent selector on the Tools page

**Files:**
- Modify: `apps/web/src/app/dashboard/tools/page.tsx`

**Interfaces:**
- Consumes: `/agents`, `/agents/:agentId/tools*`.

- [ ] **Step 1: Add the agents fetch + selector, and scope all tools calls**

In `apps/web/src/app/dashboard/tools/page.tsx`:

Add the same `agentList` / `agentId` state and mount effect as Task 14 Step 1.

Change every tools fetch path from `/tools…` to `` `/agents/${agentId}/tools…` `` (list, create, PUT, DELETE, and `/:id/test`). Guard `load()` so it only runs when `agentId` is set, and re-run it when `agentId` changes.

Render the same selector block (from Task 14 Step 1) above the tools list, shown only when `agentList.length > 1`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/tools/page.tsx
git commit -m "feat(web): per-agent tools (agent selector, agent-scoped calls)"
```

---

### Task 16: Web — channel agent picker, overview link, onboarding

**Files:**
- Modify: `apps/web/src/app/dashboard/channels/page.tsx` (per-channel agent dropdown)
- Modify: `apps/web/src/app/dashboard/page.tsx` (overview "Configure your agent" link → `/dashboard/agents`)
- Modify: `apps/web/src/components/onboarding/OnboardingWizard.tsx` (agent save → default agent)

**Interfaces:**
- Consumes: `/agents`, `PUT /channels/:id/agent`.

- [ ] **Step 1: Channels page — per-channel agent dropdown**

In `apps/web/src/app/dashboard/channels/page.tsx`, load agents once (same fetch as Task 14) into `agentList`. For each channel row, render a dropdown bound to the channel's `agentId` that calls the reassignment endpoint on change:

```tsx
  <select
    value={channel.agentId ?? ''}
    onChange={async (e) => { await apiRequest(`/channels/${channel.id}/agent`, { method: 'PUT', body: JSON.stringify({ agentId: e.target.value }) }); void reloadChannels() }}
    style={{ padding: '6px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 13 }}
  >
    {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? ' (default)' : ''}</option>)}
  </select>
```

(Use the page's existing channel-list state/reload function in place of `reloadChannels`; the channel objects already include `agentId` from `GET /channels`.)

- [ ] **Step 2: Overview link**

In `apps/web/src/app/dashboard/page.tsx`, change the "Configure your agent" step `href="/dashboard/agent"` to `href="/dashboard/agents"`.

- [ ] **Step 3: Onboarding — save to the default agent**

In `apps/web/src/components/onboarding/OnboardingWizard.tsx` (and any step component it uses to save the agent), replace the agent-save call `apiRequest('/workspace/agent', { method: 'PUT', … })` with a call that targets the default agent:

```tsx
  const agentsRes = await apiRequest('/agents')
  const { agents } = await agentsRes.json() as { agents: { id: string; isDefault: boolean }[] }
  const defaultId = agents.find((a) => a.isDefault)?.id ?? agents[0]?.id
  if (defaultId) {
    await apiRequest(`/agents/${defaultId}`, { method: 'PUT', body: JSON.stringify({ name, description, systemPrompt, llmModel }) })
  }
```

(Search the web app for any remaining `'/workspace/agent'` usage and repoint it the same way.)

- [ ] **Step 4: Typecheck + build + confirm no stale endpoints**

Run: `pnpm --filter web typecheck && pnpm --filter web build && ! grep -rn "/workspace/agent\|/workspace/key" apps/web/src`
Expected: PASS; the grep finds nothing (exit 0 from `!`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/channels/page.tsx apps/web/src/app/dashboard/page.tsx apps/web/src/components/onboarding/OnboardingWizard.tsx
git commit -m "feat(web): per-channel agent picker; onboarding + overview target /agents"
```

---

## Live E2E (after all tasks — from the spec §9)

Against the dev API + a real workspace (run `bun run apps/api/scripts/migrate-agents.ts` first on the test project):

1. **Migration:** the test workspace gains a default agent (namespace `ws_{workspaceId}`); its knowledge + tools are reparented; channels carry `agentId`; a widget chat still answers from the existing knowledge (no re-embedding).
2. **Second agent:** create an agent with a different model + systemPrompt + its own OpenRouter key; assign it to Telegram (leave the widget on the default). Confirm the widget answers in the default persona/model and Telegram answers in the second agent's persona/model/key.
3. **Knowledge isolation:** index a doc under agent B; confirm agent A (widget) cannot retrieve it (separate namespace).
4. **Delete guards:** deleting the default → 400; the last agent → 400; an agent still attached to a channel → 409 (reassign first). Deleting a spare agent purges its namespace/knowledge/tools/files.
5. **Owner gate:** a member session 403s on `/agents*`; a cross-workspace `:agentId` 404s via `requireAgent`.

Clean up test agents afterward.

## Out of scope (v1)

Per-agent usage/billing attribution; per-agent rate limits; agent-to-agent handoff/routing; sharing one knowledge doc across agents; bulk agent import; per-agent widget theming beyond name/photo.
