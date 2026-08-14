# Agent Skills Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-agent skills framework to Ayooda — a code-defined catalogue, a per-agent attachment record, and three typed hooks in the agent turn — then build Memory, Scoring and Web Search on it.

**Architecture:** A skill catalogue lives in `packages/shared` as plain data plus a hand-rolled config validator. Each agent attaches skills as documents under `workspaces/{ws}/agents/{agentId}/skills/{skillId}` carrying `enabled` + `config`. In the API, each skill is one module implementing up to three optional hooks — `contributeContext`, `contributeTools`, `afterConversation` — which `prepareTurn` calls at three fixed points, each individually try/caught so a failing skill can never cost a visitor a reply. `afterConversation` runs from a Cloud Scheduler-driven sweep endpoint.

**Tech Stack:** Bun + Hono (API), Firestore, Vercel AI SDK v7 via AI Gateway, Tavily (web search), Next.js App Router (web), `bun test`.

**Spec:** [docs/superpowers/specs/2026-08-14-agent-skills-framework-design.md](../specs/2026-08-14-agent-skills-framework-design.md)

## Global Constraints

- `packages/shared` has **zero runtime dependencies** and must keep it. Validation there is hand-rolled, returning `{ ok: true, value } | { ok: false, error }` with a human-readable message. No zod in shared or web.
- Every skill hook call site in `prepareTurn` is individually try/caught, logged with a `[skills]` prefix, and skipped on failure. A skill failure must never break a turn.
- Skill LLM calls use the fixed model `google/gemini-2.5-flash`, never the agent's configured model.
- Constants, exact values: `MAX_FACTS = 20`, memory `retentionDays` default 90 (int 1–365), `MAX_SEARCHES_PER_CONVERSATION = 3`, web search `maxResults` default 3 (int 1–5), scoring `rubric` ≤ 2000 chars, `score` integer 1–5, `summary` ≤ 500 chars, `IDLE_CLOSE_MINUTES = 30`, `SWEEP_BATCH = 100`, sweep cron every 15 minutes.
- Tier gate: `memory` and `scoring` are `minTier: null`; `web_search` is `minTier: 'core'`. Trial (tier `null`) ranks below every paid plan.
- Tests are colocated `*.test.ts` using `bun:test` and dependency injection, not mocking libraries — follow `apps/api/src/lib/workflow/engine.test.ts` and the injectable-deps style of `runAgentTurn`.
- Run tests with `cd apps/api && bun test <path>` or `cd packages/shared && bun test <path>`. Typecheck with `pnpm typecheck` from the repo root.
- **`@ayooda/shared` resolves through `packages/shared/dist/`.** After ANY change to `packages/shared`, run `pnpm --filter @ayooda/shared build` before running `apps/api` tests or `pnpm typecheck` — otherwise both fail with `Cannot find module '@ayooda/shared'`, which looks like a code error but is a stale build.

---

### Task 1: Extract plan/billing types to `packages/shared/src/plans.ts`

`SkillDef.minTier` needs `PlanTier`. Since `index.ts` will re-export `skills.ts`, importing `PlanTier` from `index.ts` inside `skills.ts` is an import cycle. This task is pure code motion to break it, with no behaviour change.

**Files:**
- Create: `packages/shared/src/plans.ts`
- Modify: `packages/shared/src/index.ts` (remove the moved block, add imports + re-export)

**Interfaces:**
- Consumes: nothing.
- Produces: `packages/shared/src/plans.ts` exporting `SubscriptionStatus`, `PlanTier`, `Subscription`, `PlanDef`, `PLANS`, `TRIAL_DAYS`, `TRIAL_CONVERSATION_CAP`, `OVERAGE_RATE_USD`, `OVERAGE_CEILING_MULTIPLIER`, `planFor`. All remain exported from `@ayooda/shared` unchanged.

- [ ] **Step 1: Run the existing shared tests to establish a green baseline**

```bash
cd packages/shared && bun test src/index.test.ts
```

Expected: PASS, including the `billing plans` describe block. These same tests are the regression check for this task — they import from `@ayooda/shared`, so if the re-export is wrong they fail.

- [ ] **Step 2: Create `packages/shared/src/plans.ts`**

Move the block currently at `packages/shared/src/index.ts:201-236` verbatim into the new file:

```ts
// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PlanTier = 'lite' | 'core' | 'max'

export interface Subscription {
  status: SubscriptionStatus
  tier: PlanTier | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface PlanDef {
  tier: PlanTier
  name: string
  priceUsd: number
  conversationCap: number
}

export const PLANS: readonly PlanDef[] = [
  { tier: 'lite', name: 'Lite', priceUsd: 25, conversationCap: 100 },
  { tier: 'core', name: 'Core', priceUsd: 55, conversationCap: 500 },
  { tier: 'max', name: 'Max', priceUsd: 195, conversationCap: 1500 },
]

export const TRIAL_DAYS = 14
export const TRIAL_CONVERSATION_CAP = 50

/** Overage: conversations beyond a plan's included pack are billed at this rate. */
export const OVERAGE_RATE_USD = 0.05
/** Safety ceiling for paying subscribers = includedCap × this multiplier. */
export const OVERAGE_CEILING_MULTIPLIER = 10

export function planFor(tier: PlanTier | null): PlanDef | undefined {
  return tier ? PLANS.find((p) => p.tier === tier) : undefined
}
```

- [ ] **Step 3: Update `packages/shared/src/index.ts`**

Delete the moved block (the whole `Billing` section). At the top of the file, add the import that `WorkspaceDoc` needs, and re-export everything:

```ts
import type { Subscription } from './plans'

export * from './plans'
```

`WorkspaceDoc.subscription?: Subscription` continues to resolve via the import.

- [ ] **Step 4: Verify no behaviour changed**

```bash
cd packages/shared && bun test src/index.test.ts
cd ../.. && pnpm typecheck
```

Expected: tests PASS unchanged, typecheck clean across all packages. If `apps/api` or `apps/web` fails to typecheck, a consumer was importing from a deep path instead of the package root — fix the consumer to import from `@ayooda/shared`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/plans.ts packages/shared/src/index.ts
git commit -m "refactor(shared): extract billing/plan types to plans.ts"
```

---

### Task 2: Skill catalogue, config validation and shared types

**Files:**
- Create: `packages/shared/src/skills.ts`
- Create: `packages/shared/src/skills.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export skills; add conversation/memory/view types)

**Interfaces:**
- Consumes: `PlanTier` from Task 1.
- Produces: `SkillId`, `MemoryConfig`, `ScoringConfig`, `WebSearchConfig`, `SkillConfig`, `SkillDef`, `SKILLS`, `skillDef(id: string): SkillDef | undefined`, `isSkillId(v: string): v is SkillId`, `validateSkillConfig(id: SkillId, raw: unknown): { ok: true; value: SkillConfig } | { ok: false; error: string }`, `meetsTier(current: PlanTier | null, min: PlanTier | null): boolean`, `VisitorMemoryFact`, `VisitorMemoryDoc`, `AgentSkillView`. Every later task depends on these names.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/skills.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { SKILLS, skillDef, isSkillId, validateSkillConfig, meetsTier } from './skills'

describe('skill catalogue', () => {
  test('every skill has a unique id and a validating default config', () => {
    const ids = SKILLS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SKILLS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
      expect(validateSkillConfig(s.id, s.defaultConfig).ok).toBe(true)
    }
  })
  test('skillDef and isSkillId resolve known ids only', () => {
    expect(skillDef('memory')?.id).toBe('memory')
    expect(skillDef('nope')).toBeUndefined()
    expect(isSkillId('web_search')).toBe(true)
    expect(isSkillId('calendar')).toBe(false)
  })
  test('web_search is the only paid-tier skill', () => {
    expect(skillDef('web_search')?.minTier).toBe('core')
    expect(skillDef('memory')?.minTier).toBeNull()
    expect(skillDef('scoring')?.minTier).toBeNull()
  })
})

describe('meetsTier', () => {
  test('a null minTier is available on every plan including trial', () => {
    expect(meetsTier(null, null)).toBe(true)
    expect(meetsTier('lite', null)).toBe(true)
  })
  test('trial ranks below every paid plan', () => {
    expect(meetsTier(null, 'core')).toBe(false)
  })
  test('the plan must reach the minimum tier', () => {
    expect(meetsTier('lite', 'core')).toBe(false)
    expect(meetsTier('core', 'core')).toBe(true)
    expect(meetsTier('max', 'core')).toBe(true)
  })
})

describe('validateSkillConfig', () => {
  test('memory defaults retentionDays and enforces its range', () => {
    expect(validateSkillConfig('memory', {})).toEqual({ ok: true, value: { retentionDays: 90 } })
    expect(validateSkillConfig('memory', { retentionDays: 30 })).toEqual({ ok: true, value: { retentionDays: 30 } })
    expect(validateSkillConfig('memory', { retentionDays: 0 }).ok).toBe(false)
    expect(validateSkillConfig('memory', { retentionDays: 366 }).ok).toBe(false)
    expect(validateSkillConfig('memory', { retentionDays: 1.5 }).ok).toBe(false)
  })
  test('scoring accepts an omitted rubric and rejects an over-long one', () => {
    expect(validateSkillConfig('scoring', {})).toEqual({ ok: true, value: {} })
    expect(validateSkillConfig('scoring', { rubric: ' grade it ' })).toEqual({ ok: true, value: { rubric: 'grade it' } })
    expect(validateSkillConfig('scoring', { rubric: 'x'.repeat(2001) }).ok).toBe(false)
  })
  test('web_search defaults maxResults and enforces its range', () => {
    expect(validateSkillConfig('web_search', {})).toEqual({ ok: true, value: { maxResults: 3 } })
    expect(validateSkillConfig('web_search', { maxResults: 5 })).toEqual({ ok: true, value: { maxResults: 5 } })
    expect(validateSkillConfig('web_search', { maxResults: 6 }).ok).toBe(false)
    expect(validateSkillConfig('web_search', { maxResults: 0 }).ok).toBe(false)
  })
  test('a non-object body is rejected', () => {
    expect(validateSkillConfig('memory', null).ok).toBe(false)
    expect(validateSkillConfig('memory', 'nope').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/shared && bun test src/skills.test.ts
```

Expected: FAIL — `Cannot find module './skills'`.

- [ ] **Step 3: Create `packages/shared/src/skills.ts`**

```ts
import type { PlanTier } from './plans'

export type SkillId = 'memory' | 'scoring' | 'web_search'

export interface MemoryConfig { retentionDays: number }
export interface ScoringConfig { rubric?: string }
export interface WebSearchConfig { maxResults: number }
export type SkillConfig = MemoryConfig | ScoringConfig | WebSearchConfig

export interface SkillDef {
  id: SkillId
  label: string
  description: string
  defaultConfig: SkillConfig
  minTier: PlanTier | null   // null = available on every plan, including trial
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'memory',
    label: 'Memory',
    description:
      'Remembers facts about a visitor — their name, account or an unresolved issue — and recalls them the next time they get in touch.',
    defaultConfig: { retentionDays: 90 } as MemoryConfig,
    minTier: null,
  },
  {
    id: 'scoring',
    label: 'Scoring',
    description:
      'Scores each finished conversation from 1 to 5 and writes a short summary, so you can spot where the agent struggled.',
    defaultConfig: {} as ScoringConfig,
    minTier: null,
  },
  {
    id: 'web_search',
    label: 'Web Search',
    description:
      'Lets the agent search the public web when an answer is not in its knowledge base.',
    defaultConfig: { maxResults: 3 } as WebSearchConfig,
    minTier: 'core',
  },
]

const SKILL_IDS: readonly string[] = SKILLS.map((s) => s.id)

export function isSkillId(v: string): v is SkillId {
  return SKILL_IDS.includes(v)
}

export function skillDef(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id)
}

/** Trial (tier null) ranks 0, below every paid plan. */
const TIER_RANK: Record<PlanTier, number> = { lite: 1, core: 2, max: 3 }
const rank = (t: PlanTier | null): number => (t ? TIER_RANK[t] : 0)

export function meetsTier(current: PlanTier | null, min: PlanTier | null): boolean {
  return rank(current) >= rank(min)
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

function intInRange(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null
  return v
}

export function validateSkillConfig(
  id: SkillId,
  raw: unknown,
): { ok: true; value: SkillConfig } | Fail {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('Config must be an object.')
  }
  const o = raw as Record<string, unknown>

  if (id === 'memory') {
    const days = o.retentionDays === undefined ? 90 : intInRange(o.retentionDays, 1, 365)
    if (days === null) return fail('Retention must be a whole number of days between 1 and 365.')
    return { ok: true, value: { retentionDays: days } }
  }

  if (id === 'scoring') {
    if (o.rubric === undefined) return { ok: true, value: {} }
    if (typeof o.rubric !== 'string') return fail('Rubric must be text.')
    const rubric = o.rubric.trim()
    if (rubric.length > 2000) return fail('Rubric must be 2000 characters or fewer.')
    return { ok: true, value: rubric ? { rubric } : {} }
  }

  const maxResults = o.maxResults === undefined ? 3 : intInRange(o.maxResults, 1, 5)
  if (maxResults === null) return fail('Max results must be a whole number between 1 and 5.')
  return { ok: true, value: { maxResults } }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/shared && bun test src/skills.test.ts
```

Expected: PASS, all describe blocks.

- [ ] **Step 5: Add the remaining shared types to `index.ts`**

Add the re-export near the other `export *`:

```ts
export * from './skills'
```

Add these fields to the existing `ConversationDoc` interface:

```ts
  agentId?: string                // which agent served this conversation (Task 7 writes it)
  score?: number                  // 1–5, written by the scoring skill
  summary?: string                // <= 500 chars
  scoredAt?: Date
  searchCallCount?: number        // web-search calls used by this conversation
  autoClosedAt?: Date             // set when the sweep closed an idle conversation
  pendingPostProcess?: boolean    // set on reaching `resolved`, cleared by the sweep
```

`agentId` is optional because conversations created before this ships will not have it; the sweep falls back to the workspace's default agent for those.

Add these new types at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Skills — runtime documents and API views
// ---------------------------------------------------------------------------

export interface VisitorMemoryFact {
  id: string
  text: string
  createdAt: Date
  expiresAt: Date
}

/** workspaces/{ws}/visitorMemory/{visitorId} */
export interface VisitorMemoryDoc {
  facts: VisitorMemoryFact[]
  nextExpiryAt: Date | null   // min(facts[].expiresAt); drives the purge query
  updatedAt: Date
}

/** One row of GET /agents/:agentId/skills — catalogue merged with attachment state. */
export interface AgentSkillView {
  id: SkillId
  label: string
  description: string
  enabled: boolean
  config: SkillConfig
  locked: boolean             // true when the workspace plan is below minTier
}
```

- [ ] **Step 6: Verify the whole package still builds**

```bash
cd packages/shared && bun test && cd ../.. && pnpm typecheck
```

Expected: all shared tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/skills.ts packages/shared/src/skills.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): skill catalogue, config validation and runtime types"
```

---

### Task 3: Skill module types and registry

**Files:**
- Create: `apps/api/src/lib/skills/types.ts`
- Create: `apps/api/src/lib/skills/registry.ts`
- Create: `apps/api/src/lib/skills/registry.test.ts`

**Interfaces:**
- Consumes: `SkillId`, `SkillConfig`, `SkillDef`, `skillDef`, `meetsTier`, `validateSkillConfig` from Task 2.
- Produces: `SkillContext<C>`, `ConversationContext<C>`, `SkillModule<C>`, `SKILL_LLM_MODEL`, `SkillRow`, `LoadedSkill`, `selectSkills(rows, tier, modules)`, `loadEnabledSkills(workspaceId, agentId, tier)`, `SKILL_MODULES`. Tasks 4–9 all build on these.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/registry.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { selectSkills, type SkillRow } from './registry'
import type { SkillModule } from './types'

const stub = (id: string): SkillModule<any> => ({ id: id as any })
const modules = { memory: stub('memory'), scoring: stub('scoring'), web_search: stub('web_search') }

const row = (over: Partial<SkillRow> = {}): SkillRow => ({
  id: 'memory', enabled: true, config: { retentionDays: 90 }, ...over,
})

describe('selectSkills', () => {
  test('returns enabled skills with validated config', () => {
    const out = selectSkills([row()], 'lite', modules)
    expect(out).toHaveLength(1)
    expect(out[0]!.def.id).toBe('memory')
    expect(out[0]!.config).toEqual({ retentionDays: 90 })
  })
  test('skips disabled rows', () => {
    expect(selectSkills([row({ enabled: false })], 'lite', modules)).toHaveLength(0)
  })
  test('skips unknown skill ids', () => {
    expect(selectSkills([row({ id: 'calendar' })], 'lite', modules)).toHaveLength(0)
  })
  test('skips a skill above the workspace tier', () => {
    const web = row({ id: 'web_search', config: { maxResults: 3 } })
    expect(selectSkills([web], 'lite', modules)).toHaveLength(0)
    expect(selectSkills([web], 'core', modules)).toHaveLength(1)
    expect(selectSkills([web], null, modules)).toHaveLength(0)
  })
  test('falls back to the default config when the stored config is invalid', () => {
    const out = selectSkills([row({ config: { retentionDays: 9999 } })], 'lite', modules)
    expect(out[0]!.config).toEqual({ retentionDays: 90 })
  })
  test('skips a skill with no registered module', () => {
    expect(selectSkills([row()], 'lite', {})).toHaveLength(0)
  })
  test('orders by the catalogue, not by input order', () => {
    const rows = [row({ id: 'web_search', config: { maxResults: 3 } }), row({ id: 'memory' })]
    expect(selectSkills(rows, 'max', modules).map((s) => s.def.id)).toEqual(['memory', 'web_search'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/registry.test.ts
```

Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/types.ts`**

```ts
import type { ToolSet } from 'ai'
import type { SkillId } from '@ayooda/shared'
import type { LangfuseTrace } from '../langfuse'

/** Skill LLM work runs on a fixed cheap model, never the agent's configured one. */
export const SKILL_LLM_MODEL = 'google/gemini-2.5-flash'

export interface SkillContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  message: string      // current user message, trimmed
  config: C            // already validated
  trace: LangfuseTrace
}

export interface ConversationContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  messages: Array<{ role: string; content: string }>
  apiKey: string       // resolved Gateway key; hooks make their own LLM calls
  config: C
}

export interface SkillModule<C = unknown> {
  id: SkillId
  contributeContext?(ctx: SkillContext<C>): Promise<string | null>
  contributeTools?(ctx: SkillContext<C>): Promise<ToolSet>
  afterConversation?(ctx: ConversationContext<C>): Promise<void>
}
```

- [ ] **Step 4: Create `apps/api/src/lib/skills/registry.ts`**

```ts
import { SKILLS, skillDef, meetsTier, validateSkillConfig, isSkillId,
         type PlanTier, type SkillConfig, type SkillDef, type SkillId } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import type { SkillModule } from './types'

export interface SkillRow { id: string; enabled: boolean; config: unknown }
export interface LoadedSkill { def: SkillDef; module: SkillModule<any>; config: SkillConfig }

export type SkillModuleMap = Partial<Record<SkillId, SkillModule<any>>>

/** Populated by each skill module's own file via registerSkill(). */
export const SKILL_MODULES: SkillModuleMap = {}

export function registerSkill(module: SkillModule<any>): void {
  SKILL_MODULES[module.id] = module
}

/**
 * Pure selection: enabled + known + entitled + has a module, config validated with
 * fallback to the catalogue default, ordered by the SKILLS array so hook order is
 * deterministic regardless of Firestore's return order.
 */
export function selectSkills(
  rows: SkillRow[],
  tier: PlanTier | null,
  modules: SkillModuleMap,
): LoadedSkill[] {
  const byId = new Map<SkillId, LoadedSkill>()
  for (const r of rows) {
    if (!r.enabled || !isSkillId(r.id)) continue
    const def = skillDef(r.id)
    if (!def || !meetsTier(tier, def.minTier)) continue
    const module = modules[r.id]
    if (!module) continue
    const parsed = validateSkillConfig(r.id, r.config)
    const config = parsed.ok ? parsed.value : def.defaultConfig
    if (!parsed.ok) console.warn(`[skills] ${r.id}: invalid stored config, using default — ${parsed.error}`)
    byId.set(r.id, { def, module, config })
  }
  return SKILLS.map((d) => byId.get(d.id)).filter((s): s is LoadedSkill => !!s)
}

export async function loadEnabledSkills(
  workspaceId: string,
  agentId: string,
  tier: PlanTier | null,
): Promise<LoadedSkill[]> {
  const snap = await adminDb
    .collection(`workspaces/${workspaceId}/agents/${agentId}/skills`)
    .where('enabled', '==', true)
    .get()
  const rows: SkillRow[] = snap.docs.map((d) => ({
    id: d.id, enabled: d.data().enabled === true, config: d.data().config ?? {},
  }))
  return selectSkills(rows, tier, SKILL_MODULES)
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/registry.test.ts
```

Expected: PASS, all seven tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/skills/types.ts apps/api/src/lib/skills/registry.ts apps/api/src/lib/skills/registry.test.ts
git commit -m "feat(api): skill module types and registry"
```

---

### Task 4: Memory skill

Recall reads one document and filters expired facts at read time — the sweep is a storage optimisation, never the correctness boundary for retention. Extraction runs once per conversation, not per turn.

**Files:**
- Create: `apps/api/src/lib/skills/memory.ts`
- Create: `apps/api/src/lib/skills/memory.test.ts`

**Interfaces:**
- Consumes: `SkillModule`, `SkillContext`, `ConversationContext`, `SKILL_LLM_MODEL`, `registerSkill` (Task 3); `MemoryConfig`, `VisitorMemoryFact` (Task 2).
- Produces: `memorySkill`, and the pure helpers `liveFacts`, `formatMemoryBlock`, `mergeFacts`, `nextExpiry`, `MAX_FACTS`. Task 9's purge uses `liveFacts` and `nextExpiry`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/memory.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { liveFacts, formatMemoryBlock, mergeFacts, nextExpiry, MAX_FACTS } from './memory'
import type { VisitorMemoryFact } from '@ayooda/shared'

const now = new Date('2026-08-14T12:00:00Z')
const fact = (over: Partial<VisitorMemoryFact> = {}): VisitorMemoryFact => ({
  id: 'f1', text: 'Prefers email', createdAt: now, expiresAt: new Date('2026-09-14T12:00:00Z'), ...over,
})

describe('liveFacts', () => {
  test('drops facts at or past their expiry', () => {
    const live = fact({ id: 'live' })
    const dead = fact({ id: 'dead', expiresAt: new Date('2026-08-14T11:59:59Z') })
    const exact = fact({ id: 'exact', expiresAt: now })
    expect(liveFacts([live, dead, exact], now).map((f) => f.id)).toEqual(['live'])
  })
  test('an empty list stays empty', () => {
    expect(liveFacts([], now)).toEqual([])
  })
})

describe('formatMemoryBlock', () => {
  test('returns null when there is nothing to recall', () => {
    expect(formatMemoryBlock([])).toBeNull()
  })
  test('renders one bullet per fact', () => {
    const block = formatMemoryBlock([fact({ text: 'Name is Ada' }), fact({ id: 'f2', text: 'On the Core plan' })])
    expect(block).toContain('- Name is Ada')
    expect(block).toContain('- On the Core plan')
  })
})

describe('mergeFacts', () => {
  const id = (i: number) => `new${i}`
  test('appends new facts with an expiry derived from retentionDays', () => {
    const out = mergeFacts([], ['Name is Ada'], now, 90, id)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('Name is Ada')
    expect(out[0]!.expiresAt.toISOString()).toBe('2026-11-12T12:00:00.000Z')
  })
  test('dedupes case-insensitively against existing facts', () => {
    const out = mergeFacts([fact({ text: 'Prefers email' })], ['prefers EMAIL', 'New thing'], now, 90, id)
    expect(out.map((f) => f.text)).toEqual(['Prefers email', 'New thing'])
  })
  test('dedupes within the incoming batch', () => {
    const out = mergeFacts([], ['Same', 'same'], now, 90, id)
    expect(out).toHaveLength(1)
  })
  test('ignores blank incoming facts', () => {
    expect(mergeFacts([], ['   ', ''], now, 90, id)).toHaveLength(0)
  })
  test('caps at MAX_FACTS by evicting oldest first', () => {
    const existing = Array.from({ length: MAX_FACTS }, (_, i) =>
      fact({ id: `old${i}`, text: `old ${i}`, createdAt: new Date(2026, 0, i + 1) }))
    const out = mergeFacts(existing, ['brand new'], now, 90, id)
    expect(out).toHaveLength(MAX_FACTS)
    expect(out.some((f) => f.id === 'old0')).toBe(false)
    expect(out.some((f) => f.text === 'brand new')).toBe(true)
  })
})

describe('nextExpiry', () => {
  test('returns the earliest expiry', () => {
    const soon = new Date('2026-08-20T00:00:00Z')
    expect(nextExpiry([fact(), fact({ id: 'f2', expiresAt: soon })])?.toISOString()).toBe(soon.toISOString())
  })
  test('returns null for no facts', () => {
    expect(nextExpiry([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/memory.test.ts
```

Expected: FAIL — `Cannot find module './memory'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/memory.ts`**

```ts
import { generateObject, createGateway } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { MemoryConfig, VisitorMemoryFact } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import { SKILL_LLM_MODEL, type ConversationContext, type SkillContext, type SkillModule } from './types'

export const MAX_FACTS = 20
const MAX_NEW_FACTS = 3
const MAX_FACT_CHARS = 200

export function liveFacts(facts: VisitorMemoryFact[], now: Date): VisitorMemoryFact[] {
  return facts.filter((f) => f.expiresAt.getTime() > now.getTime())
}

export function formatMemoryBlock(facts: VisitorMemoryFact[]): string | null {
  if (facts.length === 0) return null
  return [
    'What you remember about this visitor from previous conversations:',
    ...facts.map((f) => `- ${f.text}`),
  ].join('\n')
}

export function mergeFacts(
  existing: VisitorMemoryFact[],
  incoming: string[],
  now: Date,
  retentionDays: number,
  idFor: (i: number) => string = () => randomUUID(),
): VisitorMemoryFact[] {
  const seen = new Set(existing.map((f) => f.text.trim().toLowerCase()))
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000)
  const added: VisitorMemoryFact[] = []
  incoming.forEach((raw, i) => {
    const text = raw.trim().slice(0, MAX_FACT_CHARS)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    added.push({ id: idFor(i), text, createdAt: now, expiresAt })
  })
  const all = [...existing, ...added]
  if (all.length <= MAX_FACTS) return all
  return [...all].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(all.length - MAX_FACTS)
}

export function nextExpiry(facts: VisitorMemoryFact[]): Date | null {
  if (facts.length === 0) return null
  return facts.reduce((min, f) => (f.expiresAt < min ? f.expiresAt : min), facts[0]!.expiresAt)
}

const memoryDoc = (ws: string, visitorId: string) =>
  adminDb.doc(`workspaces/${ws}/visitorMemory/${visitorId}`)

/** Firestore returns Timestamps; normalise to Date. */
function toFacts(raw: unknown): VisitorMemoryFact[] {
  if (!Array.isArray(raw)) return []
  return raw.map((f) => ({
    id: String(f.id),
    text: String(f.text),
    createdAt: f.createdAt?.toDate?.() ?? new Date(f.createdAt),
    expiresAt: f.expiresAt?.toDate?.() ?? new Date(f.expiresAt),
  }))
}

export const memorySkill: SkillModule<MemoryConfig> = {
  id: 'memory',

  async contributeContext(ctx: SkillContext<MemoryConfig>) {
    const snap = await memoryDoc(ctx.workspaceId, ctx.visitorId).get()
    if (!snap.exists) return null
    return formatMemoryBlock(liveFacts(toFacts(snap.data()!.facts), new Date()))
  },

  async afterConversation(ctx: ConversationContext<MemoryConfig>) {
    const transcript = ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const { object } = await generateObject({
      model: createGateway({ apiKey: ctx.apiKey })(SKILL_LLM_MODEL),
      schema: z.object({ facts: z.array(z.string()).max(MAX_NEW_FACTS) }),
      prompt:
        `Extract at most ${MAX_NEW_FACTS} durable facts about the visitor from this support conversation. ` +
        `Include identity, account details, stated preferences and unresolved issues. ` +
        `Ignore small talk, anything about the agent, and anything true only during this conversation. ` +
        `Each fact must stand alone in under ${MAX_FACT_CHARS} characters. Return an empty array if there is nothing durable.` +
        `\n\n---\n${transcript}\n---`,
    })
    if (object.facts.length === 0) return

    const ref = memoryDoc(ctx.workspaceId, ctx.visitorId)
    const snap = await ref.get()
    const now = new Date()
    const existing = liveFacts(toFacts(snap.data()?.facts), now)
    const facts = mergeFacts(existing, object.facts, now, ctx.config.retentionDays)
    await ref.set({ facts, nextExpiryAt: nextExpiry(facts), updatedAt: now })
  },
}

registerSkill(memorySkill)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/memory.test.ts
```

Expected: PASS, all describe blocks. The hooks themselves are covered end-to-end in Task 7 and Task 9; these tests cover the logic that can be wrong silently.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/skills/memory.ts apps/api/src/lib/skills/memory.test.ts
git commit -m "feat(api): memory skill — per-visitor fact recall and extraction"
```

---

### Task 5: Scoring skill

**Files:**
- Create: `apps/api/src/lib/skills/scoring.ts`
- Create: `apps/api/src/lib/skills/scoring.test.ts`

**Interfaces:**
- Consumes: Task 3's types and `registerSkill`; `ScoringConfig` from Task 2.
- Produces: `scoringSkill`, `buildScoringPrompt(rubric: string | undefined, transcript: string): string`, `DEFAULT_RUBRIC`, `clampScore(n: number): number`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/scoring.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildScoringPrompt, clampScore, DEFAULT_RUBRIC } from './scoring'

describe('buildScoringPrompt', () => {
  test('uses the default rubric when none is configured', () => {
    const p = buildScoringPrompt(undefined, 'user: hi')
    expect(p).toContain(DEFAULT_RUBRIC)
    expect(p).toContain('user: hi')
  })
  test('a configured rubric replaces the default', () => {
    const p = buildScoringPrompt('Only grade politeness.', 'user: hi')
    expect(p).toContain('Only grade politeness.')
    expect(p).not.toContain(DEFAULT_RUBRIC)
  })
})

describe('clampScore', () => {
  test('keeps scores inside 1-5 and rounds to an integer', () => {
    expect(clampScore(3)).toBe(3)
    expect(clampScore(0)).toBe(1)
    expect(clampScore(9)).toBe(5)
    expect(clampScore(3.6)).toBe(4)
  })
  test('a non-finite score falls back to the midpoint', () => {
    expect(clampScore(NaN)).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/scoring.test.ts
```

Expected: FAIL — `Cannot find module './scoring'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/scoring.ts`**

```ts
import { generateObject, createGateway } from 'ai'
import { z } from 'zod'
import type { ScoringConfig } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import { SKILL_LLM_MODEL, type ConversationContext, type SkillModule } from './types'

const MAX_SUMMARY_CHARS = 500

export const DEFAULT_RUBRIC =
  'Grade how well the agent resolved the visitor\'s request. 5 = fully resolved, accurate and clear. ' +
  '3 = partially resolved, or correct but hard to follow. 1 = failed to help, was inaccurate, or ignored the question.'

export function buildScoringPrompt(rubric: string | undefined, transcript: string): string {
  return [
    'Score this customer-support conversation and summarise it for the business owner.',
    rubric?.trim() || DEFAULT_RUBRIC,
    `Write the summary in at most 2 sentences, under ${MAX_SUMMARY_CHARS} characters.`,
    `\n---\n${transcript}\n---`,
  ].join('\n\n')
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}

export const scoringSkill: SkillModule<ScoringConfig> = {
  id: 'scoring',

  async afterConversation(ctx: ConversationContext<ScoringConfig>) {
    const transcript = ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const { object } = await generateObject({
      model: createGateway({ apiKey: ctx.apiKey })(SKILL_LLM_MODEL),
      schema: z.object({ score: z.number(), summary: z.string() }),
      prompt: buildScoringPrompt(ctx.config.rubric, transcript),
    })
    await adminDb.doc(`workspaces/${ctx.workspaceId}/conversations/${ctx.conversationId}`).update({
      score: clampScore(object.score),
      summary: object.summary.trim().slice(0, MAX_SUMMARY_CHARS),
      scoredAt: new Date(),
    })
  },
}

registerSkill(scoringSkill)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/scoring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/skills/scoring.ts apps/api/src/lib/skills/scoring.test.ts
git commit -m "feat(api): scoring skill — post-conversation score and summary"
```

---

### Task 6: Web Search skill

The tool must never throw: a rejected tool promise mid-stream breaks the reply. Every failure path returns a string the model can read.

**Files:**
- Create: `apps/api/src/lib/skills/web-search.ts`
- Create: `apps/api/src/lib/skills/web-search.test.ts`

**Interfaces:**
- Consumes: Task 3's types and `registerSkill`; `WebSearchConfig` from Task 2.
- Produces: `webSearchSkill`, `MAX_SEARCHES_PER_CONVERSATION`, `formatSearchResults(results)`, `runSearch(query, maxResults, deps)`, `CAP_MESSAGE`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/web-search.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { formatSearchResults, runSearch, MAX_SEARCHES_PER_CONVERSATION, CAP_MESSAGE } from './web-search'

describe('formatSearchResults', () => {
  test('renders title, url and content per result', () => {
    const out = formatSearchResults([{ title: 'Docs', url: 'https://x.dev', content: 'How to install' }])
    expect(out).toContain('Docs')
    expect(out).toContain('https://x.dev')
    expect(out).toContain('How to install')
  })
  test('reports no results rather than returning an empty string', () => {
    expect(formatSearchResults([])).toBe('No results found.')
  })
})

describe('runSearch', () => {
  const ok = async () => new Response(JSON.stringify({
    results: [{ title: 'T', url: 'https://u', content: 'C' }],
  }), { status: 200 })

  test('returns formatted results on success', async () => {
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: ok })).toContain('T')
  })
  test('returns a string, not a throw, when the key is missing', async () => {
    expect(await runSearch('q', 3, { apiKey: '', fetch: ok })).toContain('unavailable')
  })
  test('returns a string, not a throw, on a non-200', async () => {
    const bad = async () => new Response('nope', { status: 500 })
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: bad })).toContain('failed')
  })
  test('returns a string, not a throw, when fetch rejects', async () => {
    const boom = async () => { throw new Error('network down') }
    expect(await runSearch('q', 3, { apiKey: 'k', fetch: boom })).toContain('failed')
  })
})

describe('cap', () => {
  test('the cap is three searches per conversation', () => {
    expect(MAX_SEARCHES_PER_CONVERSATION).toBe(3)
    expect(CAP_MESSAGE).toContain('limit')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/web-search.test.ts
```

Expected: FAIL — `Cannot find module './web-search'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/web-search.ts`**

```ts
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { FieldValue } from 'firebase-admin/firestore'
import type { WebSearchConfig } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { registerSkill } from './registry'
import type { SkillContext, SkillModule } from './types'

export const MAX_SEARCHES_PER_CONVERSATION = 3
export const CAP_MESSAGE = 'Search limit reached for this conversation.'
const TAVILY_URL = 'https://api.tavily.com/search'

export interface SearchResult { title: string; url: string; content: string }

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.'
  return results.map((r) => `${r.title}\n${r.url}\n${r.content}`).join('\n\n')
}

export interface SearchDeps { apiKey: string; fetch: typeof globalThis.fetch }

/** Never throws — every failure returns text the model can read and work around. */
export async function runSearch(query: string, maxResults: number, deps: SearchDeps): Promise<string> {
  if (!deps.apiKey) return 'Web search is unavailable right now.'
  try {
    const res = await deps.fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: deps.apiKey, query, max_results: maxResults }),
    })
    if (!res.ok) return `Web search failed (status ${res.status}).`
    const body = (await res.json()) as { results?: SearchResult[] }
    return formatSearchResults(body.results ?? [])
  } catch {
    return 'Web search failed.'
  }
}

export const webSearchSkill: SkillModule<WebSearchConfig> = {
  id: 'web_search',

  async contributeTools(ctx: SkillContext<WebSearchConfig>): Promise<ToolSet> {
    const convRef = adminDb.doc(`workspaces/${ctx.workspaceId}/conversations/${ctx.conversationId}`)
    return {
      web_search: tool({
        description: 'Search the public web for current information that is not in the knowledge base.',
        inputSchema: z.object({ query: z.string().describe('The search query') }),
        execute: async ({ query }: { query: string }) => {
          const span = ctx.trace.span({ name: 'skill:web_search:call', input: { query } })
          const snap = await convRef.get()
          const used = (snap.data()?.searchCallCount as number | undefined) ?? 0
          if (used >= MAX_SEARCHES_PER_CONVERSATION) {
            span.end({ output: { capped: true } })
            return CAP_MESSAGE
          }
          await convRef.update({ searchCallCount: FieldValue.increment(1) })
          const text = await runSearch(query, ctx.config.maxResults, {
            apiKey: process.env.TAVILY_API_KEY ?? '',
            fetch: globalThis.fetch,
          })
          span.end({ output: { chars: text.length } })
          return text
        },
      }),
    }
  },
}

registerSkill(webSearchSkill)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/web-search.test.ts
```

Expected: PASS, all describe blocks.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/skills/web-search.ts apps/api/src/lib/skills/web-search.test.ts
git commit -m "feat(api): web search skill backed by Tavily"
```

---

### Task 7: Turn integration

The critical deliverable is the last test: an always-throwing skill must still yield a complete reply.

**Files:**
- Create: `apps/api/src/lib/skills/run.ts`
- Create: `apps/api/src/lib/skills/run.test.ts`
- Create: `apps/api/src/lib/skills/all.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts`
- Modify: `apps/api/src/lib/chat/tools.ts:196-215` (`runAgentTurn` signature and tool merge)

**Interfaces:**
- Consumes: `LoadedSkill`, `loadEnabledSkills` (Task 3); the three skill modules (Tasks 4–6).
- Produces: `gatherContext(skills, ctx): Promise<string[]>`, `gatherTools(skills, ctx): Promise<ToolSet>`; `ReadyTurn` gains `skillTools: ToolSet`; `runAgentTurn(chatParams, tools, trace, deps, skillTools)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/run.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { gatherContext, gatherTools } from './run'
import type { LoadedSkill } from './registry'
import type { SkillContext, SkillModule } from './types'

const trace = { span: () => ({ end: () => {} }) } as any
const ctx = {
  workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v',
  message: 'hi', config: {}, trace,
} as SkillContext<any>

const loaded = (module: SkillModule<any>): LoadedSkill => ({
  def: { id: module.id, label: 'L', description: 'D', defaultConfig: {}, minTier: null },
  module, config: {},
})

describe('gatherContext', () => {
  test('collects non-null blocks in order', async () => {
    const a = loaded({ id: 'memory', contributeContext: async () => 'A' })
    const b = loaded({ id: 'scoring', contributeContext: async () => 'B' })
    expect(await gatherContext([a, b], ctx)).toEqual(['A', 'B'])
  })
  test('skips skills with no hook and null returns', async () => {
    const none = loaded({ id: 'memory' })
    const nul = loaded({ id: 'scoring', contributeContext: async () => null })
    expect(await gatherContext([none, nul], ctx)).toEqual([])
  })
  test('a throwing skill is skipped and the rest still contribute', async () => {
    const boom = loaded({ id: 'memory', contributeContext: async () => { throw new Error('boom') } })
    const ok = loaded({ id: 'scoring', contributeContext: async () => 'OK' })
    expect(await gatherContext([boom, ok], ctx)).toEqual(['OK'])
  })
})

describe('gatherTools', () => {
  test('merges tool sets from every skill', async () => {
    const a = loaded({ id: 'web_search', contributeTools: async () => ({ web_search: {} as any }) })
    const b = loaded({ id: 'memory', contributeTools: async () => ({ other: {} as any }) })
    expect(Object.keys(await gatherTools([a, b], ctx)).sort()).toEqual(['other', 'web_search'])
  })
  test('a throwing skill contributes nothing and does not break the rest', async () => {
    const boom = loaded({ id: 'memory', contributeTools: async () => { throw new Error('boom') } })
    const ok = loaded({ id: 'web_search', contributeTools: async () => ({ web_search: {} as any }) })
    expect(Object.keys(await gatherTools([boom, ok], ctx))).toEqual(['web_search'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/run.test.ts
```

Expected: FAIL — `Cannot find module './run'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/run.ts`**

```ts
import type { ToolSet } from 'ai'
import type { LoadedSkill } from './registry'
import type { SkillContext } from './types'

/** Every hook is isolated: a failing skill is logged and skipped, never fatal. */
export async function gatherContext(skills: LoadedSkill[], ctx: SkillContext<any>): Promise<string[]> {
  const results = await Promise.all(
    skills.map(async (s) => {
      if (!s.module.contributeContext) return null
      const span = ctx.trace.span({ name: `skill:${s.def.id}:context` })
      try {
        const block = await s.module.contributeContext({ ...ctx, config: s.config })
        span.end({ output: { chars: block?.length ?? 0 } })
        return block
      } catch (err) {
        console.warn(`[skills] ${s.def.id} contributeContext failed:`, err)
        span.end({ output: { error: true } })
        return null
      }
    }),
  )
  return results.filter((b): b is string => !!b)
}

export async function gatherTools(skills: LoadedSkill[], ctx: SkillContext<any>): Promise<ToolSet> {
  let out: ToolSet = {}
  for (const s of skills) {
    if (!s.module.contributeTools) continue
    try {
      out = { ...out, ...(await s.module.contributeTools({ ...ctx, config: s.config })) }
    } catch (err) {
      console.warn(`[skills] ${s.def.id} contributeTools failed:`, err)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/run.test.ts
```

Expected: PASS, all five tests.

- [ ] **Step 5: Wire the hooks into `prepareTurn`**

First create the registration barrel `apps/api/src/lib/skills/all.ts`:

```ts
/**
 * Importing a skill module runs its registerSkill() side effect. Every entry point
 * that reads SKILL_MODULES — the turn and the sweep — imports this barrel, so
 * registration has one owner. Without it, selectSkills silently skips the skill.
 */
import './memory'
import './scoring'
import './web-search'
```

Then in `apps/api/src/lib/chat/agent-turn.ts`, add the imports:

```ts
import { loadEnabledSkills, type LoadedSkill } from '../skills/registry'
import { gatherContext, gatherTools } from '../skills/run'
import '../skills/all'
```

Immediately after `const llmModel: string = ...` (the end of agent resolution, around line 96), load the skills:

```ts
  let skills: LoadedSkill[] = []
  try {
    const tier = (workspaceData.subscription?.tier as PlanTier | null | undefined) ?? null
    skills = await loadEnabledSkills(workspaceId, agentRec.id, tier)
  } catch (err) {
    console.warn('[skills] load failed:', err)
  }
```

Add `PlanTier` to the existing `@ayooda/shared` import.

After the RAG block and before the escalation block, gather context. Build the shared context object once:

```ts
  const skillCtx = {
    workspaceId, agentId: agentRec.id, conversationId, visitorId,
    message: trimmed, config: {}, trace,
  }
  const skillBlocks = skills.length ? await gatherContext(skills, skillCtx) : []
```

Extend the existing `contextSection` assembly so skill blocks join the same section:

```ts
  const allBlocks = [...contextBlocks, ...skillBlocks]
  const contextSection =
    allBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${allBlocks.join('\n\n')}\n---`
      : ''
```

After the existing `loadTools` block, gather skill tools:

```ts
  let skillTools: ToolSet = {}
  if (skills.length) skillTools = await gatherTools(skills, skillCtx)
```

Import `type ToolSet` from `'ai'`. Add `skillTools` to the `ReadyTurn` interface and to the returned object.

Finally, record which agent served the conversation. In the `convRef.set({...})` call that creates a new conversation (inside the `if (!convSnap.exists)` block), add one field:

```ts
      agentId: agentRec.id,
```

Without it the sweep cannot tell which agent answered, and would score every conversation under the workspace's default agent — wrong skills, wrong config, whenever a non-default agent served the chat.

- [ ] **Step 6: Merge skill tools in `runAgentTurn`**

In `apps/api/src/lib/chat/tools.ts`, add a fifth parameter and merge, with customer tools winning a name collision:

```ts
export async function* runAgentTurn(
  chatParams: ChatParams,
  tools: StoredTool[],
  trace: LangfuseTrace,
  deps: RunDeps = {},
  skillTools: ToolSet = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
```

Replace the `run({...})` call. The current line is `tools: tools.length ? toAiSdkTools(tools, trace, execute) : undefined` — keep the `undefined` when there are no tools at all, since passing an empty object changes how the SDK builds the request:

```ts
  const customerTools = tools.length ? toAiSdkTools(tools, trace, execute) : {}
  for (const name of Object.keys(customerTools)) {
    if (name in skillTools) console.warn(`[skills] tool name "${name}" shadowed by a customer tool`)
  }
  const toolSet: ToolSet = { ...skillTools, ...customerTools }
  const result = run({
    model: chatParams.model,
    system: chatParams.systemPrompt,
    messages: chatParams.messages,
    tools: Object.keys(toolSet).length ? toolSet : undefined,
    stopWhen: stepCountIs(MAX_ROUNDS),
  })
```

Spreading `customerTools` last is what makes a customer's tool win a name collision.

- [ ] **Step 7: Update both callers to pass `skillTools`**

```bash
cd apps/api && grep -rn "runAgentTurn(" src/routes/
```

Expected: two call sites — the widget SSE route and the Telegram route. Add `turn.skillTools` as the fifth argument at each (pass `{}` for the fourth `deps` argument where it is currently omitted).

- [ ] **Step 8: Verify the whole suite and typecheck**

```bash
cd apps/api && bun test && cd ../.. && pnpm typecheck
```

Expected: all API tests PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/skills/run.ts apps/api/src/lib/skills/run.test.ts \
        apps/api/src/lib/chat/agent-turn.ts apps/api/src/lib/chat/tools.ts apps/api/src/routes/
git commit -m "feat(api): call skill hooks from prepareTurn with per-hook isolation"
```

---

### Task 8: Skills API routes

**Files:**
- Create: `apps/api/src/routes/skills.ts`
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**
- Consumes: `SKILLS`, `skillDef`, `isSkillId`, `validateSkillConfig`, `meetsTier`, `AgentSkillView` (Task 2).
- Produces: `GET|PUT|DELETE /agents/:agentId/skills[/:skillId]`.

- [ ] **Step 1: Create `apps/api/src/routes/skills.ts`**

Mirror `apps/api/src/routes/tools.ts` — same middleware stack, same response style.

```ts
import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'
import { SKILLS, skillDef, isSkillId, validateSkillConfig, meetsTier,
         type AgentSkillView, type PlanTier } from '@ayooda/shared'

const skills = new Hono<{ Variables: AuthVariables }>()
skills.use('*', requireAuth)
skills.use('*', requireOwner)
skills.use('*', requireAgent)

async function workspaceTier(ws: string): Promise<PlanTier | null> {
  const snap = await adminDb.doc(`workspaces/${ws}`).get()
  return (snap.data()?.subscription?.tier as PlanTier | null | undefined) ?? null
}

/** GET /agents/:agentId/skills — catalogue merged with attachment state. */
skills.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const [snap, tier] = await Promise.all([
    adminDb.collection(`workspaces/${ws}/agents/${agentId}/skills`).get(),
    workspaceTier(ws),
  ])
  const rows = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const view: AgentSkillView[] = SKILLS.map((def) => {
    const row = rows.get(def.id)
    const parsed = validateSkillConfig(def.id, row?.config ?? def.defaultConfig)
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      enabled: row?.enabled === true,
      config: parsed.ok ? parsed.value : def.defaultConfig,
      locked: !meetsTier(tier, def.minTier),
    }
  })
  return c.json({ skills: view })
})

/** PUT /agents/:agentId/skills/:skillId — attach or update. */
skills.put('/:skillId', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const skillId = c.req.param('skillId')
  if (!isSkillId(skillId)) return c.json({ error: 'Unknown skill.' }, 404)
  const def = skillDef(skillId)!

  const body = await c.req.json<{ enabled?: unknown; config?: unknown }>().catch(() => null)
  if (!body || typeof body.enabled !== 'boolean') return c.json({ error: 'enabled is required.' }, 400)

  const parsed = validateSkillConfig(skillId, body.config ?? def.defaultConfig)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  if (body.enabled && !meetsTier(await workspaceTier(ws), def.minTier)) {
    return c.json({ error: `${def.label} is not available on your plan.` }, 403)
  }

  const ref = adminDb.doc(`workspaces/${ws}/agents/${agentId}/skills/${skillId}`)
  const now = new Date()
  const exists = (await ref.get()).exists
  await ref.set(
    { enabled: body.enabled, config: parsed.value, updatedAt: now, ...(exists ? {} : { createdAt: now }) },
    { merge: true },
  )
  return c.json({ ok: true })
})

/** DELETE /agents/:agentId/skills/:skillId — detach. Skill-owned data is left intact. */
skills.delete('/:skillId', async (c) => {
  const ws = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const skillId = c.req.param('skillId')
  if (!isSkillId(skillId)) return c.json({ error: 'Unknown skill.' }, 404)
  await adminDb.doc(`workspaces/${ws}/agents/${agentId}/skills/${skillId}`).delete()
  return c.json({ ok: true })
})

export default skills
```

- [ ] **Step 2: Mount the router**

In `apps/api/src/index.ts`, next to the tools mount:

```ts
import skillRoutes from './routes/skills'
app.route('/agents/:agentId/skills', skillRoutes)
```

- [ ] **Step 3: Verify by hand against a running API**

```bash
pnpm dev:api
```

With a Firebase ID token for a workspace owner in `$TOKEN` and a real agent id in `$AGENT`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:3001/agents/$AGENT/skills | jq
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":true,"config":{"retentionDays":30}}' localhost:3001/agents/$AGENT/skills/memory
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":true,"config":{"retentionDays":9999}}' localhost:3001/agents/$AGENT/skills/memory
```

Expected: the GET lists three skills, all `enabled: false`, with `web_search` `locked: true` on a trial or Lite workspace. The first PUT returns `{"ok":true}` and flips `memory` to enabled with `retentionDays: 30`. The second returns 400 with the range message.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add apps/api/src/routes/skills.ts apps/api/src/index.ts
git commit -m "feat(api): skills CRUD routes"
```

---

### Task 9: Sweep endpoint, resolve flag and indexes

**Files:**
- Create: `apps/api/src/lib/skills/sweep.ts`
- Create: `apps/api/src/lib/skills/sweep.test.ts`
- Create: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/src/routes/conversations.ts:72-88` (resolve sets `pendingPostProcess`)
- Modify: `apps/api/src/index.ts` (mount `/internal`)
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: `loadEnabledSkills` (Task 3); `liveFacts`, `nextExpiry` (Task 4).
- Produces: `idleCutoff(now)`, `secretMatches(provided, expected)`, `purgeFacts(facts, now)`, `IDLE_CLOSE_MINUTES`, `SWEEP_BATCH`, `runSweep()`; `POST /internal/sweep`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/skills/sweep.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { idleCutoff, secretMatches, purgeFacts, IDLE_CLOSE_MINUTES, SWEEP_BATCH } from './sweep'
import type { VisitorMemoryFact } from '@ayooda/shared'

const now = new Date('2026-08-14T12:00:00Z')

describe('idleCutoff', () => {
  test('is IDLE_CLOSE_MINUTES before now', () => {
    expect(idleCutoff(now).toISOString()).toBe('2026-08-14T11:30:00.000Z')
    expect(IDLE_CLOSE_MINUTES).toBe(30)
  })
})

describe('secretMatches', () => {
  test('accepts an exact match and rejects everything else', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abd', 'abc')).toBe(false)
    expect(secretMatches('ab', 'abc')).toBe(false)
  })
  test('rejects when either side is empty, so an unset env var never opens the endpoint', () => {
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches('abc', '')).toBe(false)
    expect(secretMatches('', 'abc')).toBe(false)
  })
})

describe('purgeFacts', () => {
  const fact = (id: string, iso: string): VisitorMemoryFact =>
    ({ id, text: id, createdAt: now, expiresAt: new Date(iso) })

  test('drops expired facts and recomputes the next expiry', () => {
    const out = purgeFacts([fact('dead', '2026-08-01T00:00:00Z'), fact('live', '2026-09-01T00:00:00Z')], now)
    expect(out.facts.map((f) => f.id)).toEqual(['live'])
    expect(out.nextExpiryAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
  test('an all-expired document ends with a null next expiry', () => {
    const out = purgeFacts([fact('dead', '2026-08-01T00:00:00Z')], now)
    expect(out.facts).toEqual([])
    expect(out.nextExpiryAt).toBeNull()
  })
})

describe('batch size', () => {
  test('is bounded so a run has predictable cost', () => {
    expect(SWEEP_BATCH).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && bun test src/lib/skills/sweep.test.ts
```

Expected: FAIL — `Cannot find module './sweep'`.

- [ ] **Step 3: Create `apps/api/src/lib/skills/sweep.ts`**

```ts
import { timingSafeEqual } from 'node:crypto'
import type { PlanTier, VisitorMemoryFact } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { resolveGatewayKey } from '../llm/resolve'
import { liveFacts, nextExpiry } from './memory'
import { loadEnabledSkills } from './registry'
import './all'   // registers every skill module; without it the sweep silently skips scoring

export const IDLE_CLOSE_MINUTES = 30
export const SWEEP_BATCH = 100

export function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - IDLE_CLOSE_MINUTES * 60_000)
}

/** Constant-time compare; an empty expected secret never matches, so an unset env var stays closed. */
export function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function purgeFacts(
  facts: VisitorMemoryFact[],
  now: Date,
): { facts: VisitorMemoryFact[]; nextExpiryAt: Date | null } {
  const kept = liveFacts(facts, now)
  return { facts: kept, nextExpiryAt: nextExpiry(kept) }
}

export interface SweepReport { closed: number; scored: number; purged: number; failed: number }

export async function runSweep(now = new Date()): Promise<SweepReport> {
  const report: SweepReport = { closed: 0, scored: 0, purged: 0, failed: 0 }

  // 1. Close idle bot conversations.
  const idle = await adminDb
    .collectionGroup('conversations')
    .where('status', '==', 'bot')
    .where('updatedAt', '<', idleCutoff(now))
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of idle.docs) {
    try {
      await doc.ref.update({ status: 'resolved', autoClosedAt: now, pendingPostProcess: true })
      report.closed++
    } catch (err) {
      console.warn('[sweep] close failed:', doc.ref.path, err)
      report.failed++
    }
  }

  // 2. Post-process everything flagged — auto-closed and operator-resolved alike.
  const pending = await adminDb
    .collectionGroup('conversations')
    .where('pendingPostProcess', '==', true)
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of pending.docs) {
    try {
      await postProcess(doc)
      await doc.ref.update({ pendingPostProcess: false })
      report.scored++
    } catch (err) {
      // The flag stays set, so the next run retries this conversation.
      console.warn('[sweep] post-process failed:', doc.ref.path, err)
      report.failed++
    }
  }

  // 3. Purge expired memory.
  const stale = await adminDb
    .collectionGroup('visitorMemory')
    .where('nextExpiryAt', '<=', now)
    .limit(SWEEP_BATCH)
    .get()
  for (const doc of stale.docs) {
    try {
      const raw = (doc.data().facts ?? []) as Array<Record<string, any>>
      const facts: VisitorMemoryFact[] = raw.map((f) => ({
        id: String(f.id), text: String(f.text),
        createdAt: f.createdAt?.toDate?.() ?? new Date(f.createdAt),
        expiresAt: f.expiresAt?.toDate?.() ?? new Date(f.expiresAt),
      }))
      await doc.ref.update({ ...purgeFacts(facts, now), updatedAt: now })
      report.purged++
    } catch (err) {
      console.warn('[sweep] purge failed:', doc.ref.path, err)
      report.failed++
    }
  }

  return report
}

async function postProcess(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const data = doc.data()
  if (data.scoredAt) return               // already processed; never double-charge
  // workspaces/{ws}/conversations/{id}
  const workspaceId = doc.ref.parent.parent!.id
  const conversationId = doc.id

  const wsSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const tier = (wsSnap.data()?.subscription?.tier as PlanTier | null | undefined) ?? null

  // Prefer the agent that actually served the conversation. Conversations created
  // before this feature shipped have no agentId — fall back to the default agent.
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  let agentDoc: FirebaseFirestore.DocumentSnapshot | null = null
  if (typeof data.agentId === 'string' && data.agentId) {
    const byId = await agentsCol.doc(data.agentId).get()
    if (byId.exists) agentDoc = byId
  }
  if (!agentDoc) {
    const defaultSnap = await agentsCol.where('isDefault', '==', true).limit(1).get()
    agentDoc = defaultSnap.empty ? null : defaultSnap.docs[0]!
  }
  if (!agentDoc) return

  const skills = (await loadEnabledSkills(workspaceId, agentDoc.id, tier))
    .filter((s) => !!s.module.afterConversation)
  if (skills.length === 0) return

  const key = resolveGatewayKey(agentDoc.data()?.gatewayKey)
  if (!key.ok) return

  const msgSnap = await doc.ref.collection('messages').orderBy('createdAt', 'asc').limit(50).get()
  const messages = msgSnap.docs.map((m) => ({
    role: String(m.data().role), content: String(m.data().content),
  }))
  if (messages.length === 0) return

  for (const s of skills) {
    try {
      await s.module.afterConversation!({
        workspaceId, agentId: agentDoc.id, conversationId,
        visitorId: String(data.visitorId ?? ''),
        messages, apiKey: key.apiKey, config: s.config,
      })
    } catch (err) {
      console.warn(`[sweep] ${s.def.id} afterConversation failed:`, doc.ref.path, err)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test src/lib/skills/sweep.test.ts
```

Expected: PASS, all describe blocks.

- [ ] **Step 5: Create `apps/api/src/routes/internal.ts`**

```ts
import { Hono } from 'hono'
import { runSweep, secretMatches } from '../lib/skills/sweep'

const internal = new Hono()

/** POST /internal/sweep — called by Cloud Scheduler. Not part of the public API. */
internal.post('/sweep', async (c) => {
  if (!secretMatches(c.req.header('x-sweep-secret') ?? '', process.env.SWEEP_SECRET ?? '')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json(await runSweep())
})

export default internal
```

Mount it in `apps/api/src/index.ts` alongside the other public routers (it authenticates itself, so it must not sit behind `requireAuth`):

```ts
import internalRoutes from './routes/internal'
app.route('/internal', internalRoutes)
```

- [ ] **Step 6: Set `pendingPostProcess` when an operator resolves a conversation**

In `apps/api/src/routes/conversations.ts`, in the `POST /:id/resolve` handler, add the flag to the existing update:

```ts
  await convRef.update({
    status: 'resolved',
    operatorId: null,
    pendingPostProcess: true,
    updatedAt: FieldValue.serverTimestamp(),
  })
```

Without this, operator-resolved conversations are never scored — the sweep would only ever see the ones it closed itself.

- [ ] **Step 7: Add the Firestore indexes**

In `firestore.indexes.json`, add to `indexes`:

```json
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "ASCENDING" }
      ]
    }
```

and to `fieldOverrides`, so the two single-field collection-group queries work:

```json
    {
      "collectionGroup": "conversations",
      "fieldPath": "pendingPostProcess",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "visitorMemory",
      "fieldPath": "nextExpiryAt",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

Deploy them:

```bash
firebase deploy --only firestore:indexes
```

- [ ] **Step 8: Verify the endpoint by hand**

```bash
SWEEP_SECRET=testsecret pnpm dev:api
```

```bash
curl -s -X POST localhost:3001/internal/sweep
curl -s -X POST -H 'x-sweep-secret: testsecret' localhost:3001/internal/sweep
```

Expected: the first returns 401; the second returns a JSON report such as `{"closed":0,"scored":0,"purged":0,"failed":0}`. If Firestore reports a missing index, the index deploy in Step 7 has not finished — wait and retry.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/skills/sweep.ts apps/api/src/lib/skills/sweep.test.ts \
        apps/api/src/routes/internal.ts apps/api/src/routes/conversations.ts \
        apps/api/src/index.ts firestore.indexes.json
git commit -m "feat(api): sweep endpoint for idle close, scoring and memory purge"
```

---

### Task 10: Skills UI in the agent editor

**Files:**
- Create: `apps/web/src/components/dashboard/AgentSkills.tsx`
- Modify: `apps/web/src/app/dashboard/agents/page.tsx` (render the component in the editor)

**Interfaces:**
- Consumes: `AgentSkillView`, `SkillId`, `SkillConfig` (Task 2); the routes from Task 8.
- Produces: `<AgentSkills agentId={string} />`.

A separate component file rather than growing `page.tsx`, which is already 161 lines holding the whole agent editor.

- [ ] **Step 1: Create `apps/web/src/components/dashboard/AgentSkills.tsx`**

The API helper is `apiRequest(path, init) => Promise<Response>` — it returns the raw response, so callers check `res.ok` and read `error` off the body. That is the idiom throughout `page.tsx`; match it rather than introducing a wrapper. Reuse the same CSS variables (`--panel`, `--line`, `--ink-mute`) as the surrounding page.

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AgentSkillView, SkillId } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'

const card: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: 16, marginBottom: 12,
}
const muted: React.CSSProperties = { color: 'var(--ink-mute)', fontSize: 13 }

export default function AgentSkills({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<AgentSkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<SkillId | ''>('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest(`/agents/${agentId}/skills`)
      if (res.ok) { const d = await res.json() as { skills: AgentSkillView[] }; setSkills(d.skills) }
      else setError('Could not load skills.')
    } finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  const save = async (s: AgentSkillView, next: Partial<AgentSkillView>) => {
    setBusy(s.id); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/skills/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next.enabled ?? s.enabled, config: next.config ?? s.config }),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save that skill.'); return }
      await load()
    } finally { setBusy('') }
  }

  if (loading) return <p style={muted}>Loading skills…</p>

  return (
    <div>
      {error && <p style={{ ...muted, color: 'var(--danger)' }}>{error}</p>}
      {skills.map((s) => (
        <div key={s.id} style={{ ...card, opacity: s.locked ? 0.6 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <strong>{s.label}</strong>
              <p style={muted}>{s.description}</p>
            </div>
            {s.locked ? (
              <span style={muted}>Upgrade to enable</span>
            ) : (
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy === s.id}
                onChange={(e) => void save(s, { enabled: e.target.checked })}
                aria-label={`Enable ${s.label}`}
              />
            )}
          </div>
          {s.enabled && !s.locked && <SkillConfigFields skill={s} onSave={save} busy={busy === s.id} />}
        </div>
      ))}
    </div>
  )
}

function SkillConfigFields({
  skill, onSave, busy,
}: {
  skill: AgentSkillView
  onSave: (s: AgentSkillView, next: Partial<AgentSkillView>) => Promise<void>
  busy: boolean
}) {
  const cfg = skill.config as Record<string, unknown>
  const num = (key: string, labelText: string, min: number, max: number) => (
    <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
      {labelText}
      <input
        type="number" min={min} max={max} disabled={busy}
        defaultValue={Number(cfg[key])}
        onBlur={(e) => void onSave(skill, { config: { ...cfg, [key]: Number(e.target.value) } as never })}
        style={{ marginLeft: 8, width: 90 }}
      />
    </label>
  )

  if (skill.id === 'memory') return num('retentionDays', 'Remember facts for (days)', 1, 365)
  if (skill.id === 'web_search') return num('maxResults', 'Results per search', 1, 5)
  return (
    <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
      Custom rubric (optional)
      <textarea
        rows={3} disabled={busy} defaultValue={String(cfg.rubric ?? '')}
        onBlur={(e) => void onSave(skill, { config: { rubric: e.target.value } as never })}
        style={{ width: '100%', marginTop: 4 }}
      />
    </label>
  )
}
```

- [ ] **Step 2: Render it in the agent editor**

In `apps/web/src/app/dashboard/agents/page.tsx`, import the component and render it inside the editor block, below the existing fields:

```tsx
import AgentSkills from '@/components/dashboard/AgentSkills'

// …inside the editor, where the agent being edited has an id:
<div style={card}>
  <div style={label}>Skills</div>
  <AgentSkills agentId={editor.id} />
</div>
```

- [ ] **Step 3: Verify in the browser**

```bash
pnpm dev
```

Open `/dashboard/agents`, edit an agent, and confirm: three skills listed; Web Search greyed with "Upgrade to enable" on a trial or Lite workspace; toggling Memory on reveals a retention field; entering `400` and blurring shows the range error from the API; reloading the page preserves the toggle state.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add apps/web/src/components/dashboard/AgentSkills.tsx apps/web/src/app/dashboard/agents/page.tsx
git commit -m "feat(web): skills section in the agent editor"
```

---

### Task 11: Scores in the inbox, docs and deploy

**Files:**
- Modify: `apps/web/src/app/dashboard/inbox/page.tsx` (score badge + summary)
- Modify: `docs/architecture.md`
- Modify: `docs/deploy.md`

**Interfaces:**
- Consumes: `ConversationDoc.score` / `.summary` (Task 2), written by Task 9.
- Produces: no new code interfaces.

- [ ] **Step 1: Surface the score in the inbox**

The inbox is a single `apps/web/src/app/dashboard/inbox/page.tsx`. Add `score?: number` and `summary?: string` to whatever local conversation type it declares, then two render additions.

In the conversation list row, after the existing title/last-message markup:

```tsx
{typeof conv.score === 'number' && (
  <span
    style={{
      fontSize: 11, fontFamily: 'var(--font-mono)', padding: '2px 6px',
      borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', color: 'var(--ink-mute)',
    }}
    title="Conversation score"
  >
    {conv.score}/5
  </span>
)}
```

In the detail pane, above the message thread:

```tsx
{selected?.summary && (
  <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 12 }}>{selected.summary}</p>
)}
```

Both fields are optional: a conversation with neither must render exactly as it does today. Use whatever the page already names its list item and selected conversation instead of `conv`/`selected`.

- [ ] **Step 2: Verify in the browser**

```bash
pnpm dev
```

Resolve a conversation from the inbox, run the sweep manually:

```bash
curl -s -X POST -H "x-sweep-secret: $SWEEP_SECRET" localhost:3001/internal/sweep
```

Expected: the report shows `scored: 1`, and after a reload the conversation shows a score badge and a summary. Conversations resolved before this feature shipped show neither and are unaffected.

- [ ] **Step 3: Document the architecture**

In `docs/architecture.md`, add a **Skills** subsection under Services covering: the catalogue in `packages/shared/src/skills.ts`; the `workspaces/{ws}/agents/{agentId}/skills/{skillId}` attachment; the three hooks and where `prepareTurn` calls them; and the sweep. Add `visitorMemory/` to the Firestore tree in the infrastructure diagram.

- [ ] **Step 4: Document deployment**

In `docs/deploy.md`, add the two new environment variables for `ayooda-api`:

- `TAVILY_API_KEY` — Tavily search key. Without it the Web Search skill disables itself with a warning rather than failing per turn.
- `SWEEP_SECRET` — long random string shared with Cloud Scheduler. Without it `/internal/sweep` rejects every request.

And the scheduler job:

```bash
gcloud scheduler jobs create http ayooda-sweep \
  --location=<REGION> \
  --schedule="*/15 * * * *" \
  --uri="https://<API_HOST>/internal/sweep" \
  --http-method=POST \
  --headers="x-sweep-secret=<SWEEP_SECRET>"
```

Note the follow-up: switch to OIDC (`--oidc-service-account-email`) and verify the token in `routes/internal.ts` instead of the shared header.

- [ ] **Step 5: Full verification**

```bash
pnpm typecheck && cd apps/api && bun test && cd ../packages/shared && bun test
```

Expected: typecheck clean, every test PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/dashboard/inbox docs/architecture.md docs/deploy.md
git commit -m "feat(web): conversation scores in the inbox; docs for skills and sweep"
```

---

## Verification checklist

Run before calling the feature done:

- [ ] `pnpm typecheck` clean across all packages
- [ ] `cd packages/shared && bun test` — all pass
- [ ] `cd apps/api && bun test` — all pass, including the throwing-skill isolation tests in `run.test.ts`
- [ ] An agent with no skills attached behaves exactly as before (send a widget message, get a reply)
- [ ] Enabling Memory, chatting, resolving, running the sweep, then starting a new conversation as the same visitor produces recall in the reply
- [ ] Enabling Web Search on a Core workspace lets the agent answer a question outside its knowledge base; the fourth search in one conversation returns the cap message
- [ ] `/internal/sweep` returns 401 without the secret
