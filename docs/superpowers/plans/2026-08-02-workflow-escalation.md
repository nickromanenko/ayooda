# Workflow Builder (Escalation Rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner define an ordered list of rules that escalate a conversation to a human during a bot turn (visitor asks for a human, low knowledge confidence, N bot replies, keyword, off-hours), first match wins.

**Architecture:** A pure rules engine (`evaluateRules`) runs inside `prepareTurn` after RAG. On a match the conversation moves to a new `waiting` status with a handoff message and the bot goes silent; a silence guard makes any non-`bot` conversation stop getting bot replies. An owner-only `/workflows` CRUD route manages rules; the inbox gets a Waiting filter; a Workflows page edits rules.

**Tech Stack:** Bun + Hono (api), Firestore Admin SDK, `Intl.DateTimeFormat` (off-hours timezones), `@ayooda/shared`, Next.js App Router client pages. Tests: `bun test`.

## Global Constraints

- **Triggers (v1):** `ask_for_human` (phrase substring), `low_confidence` (0 RAG sources over the 0.6 threshold), `bot_replies` (`botReplyCount >= count`), `keyword` (substring), `off_hours` (outside a weekly window in a timezone). **Action (v1):** `escalate` + optional `handoffMessage`.
- **Rules are workspace-level**, in `workspaces/{id}/workflowRules`. First **enabled** rule by ascending `order` wins.
- **New conversation status `waiting`** (escalated, `operatorId: null`), distinct from `human`. `ConversationStatus = 'bot' | 'waiting' | 'human' | 'resolved'`.
- **Silence guard:** a conversation whose status is not `bot` never gets a bot reply — `prepareTurn` returns `{ kind: 'silent' }`; Telegram's pre-check broadens to `status !== 'bot'`.
- **Default handoff:** `DEFAULT_HANDOFF = 'Let me connect you with someone from our team.'`
- **Escalation persists the handoff message once** (inside `prepareTurn`); channel callers only deliver it.
- **Routes** `/workflows*` are owner-only (`requireAuth` + `requireOwner`). **Web** pages mirror the existing dashboard client-page idiom (`'use client'` + `apiRequest`, inline styles); `apps/web/AGENTS.md` — modified Next.js, no new framework APIs.
- **Billing unaffected:** escalated turns make no LLM call; `botReplyCount` is not a billing counter.

---

### Task 1: Shared types + `waiting` status

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `WorkflowTrigger` (discriminated union), `WorkflowAction`, `WorkflowRule`, `EscalationContext`; `ConversationStatus` gains `'waiting'`; `ConversationDoc` gains `escalationReason?`, `botReplyCount?`.

- [ ] **Step 1: Add the `waiting` status + conversation fields**

In `packages/shared/src/index.ts`, change:

```ts
export type ConversationStatus = 'bot' | 'human' | 'resolved'
```

to:

```ts
export type ConversationStatus = 'bot' | 'waiting' | 'human' | 'resolved'
```

In `ConversationDoc`, add after `operatorId`:

```ts
  escalationReason?: string
  botReplyCount?: number
```

- [ ] **Step 2: Add the workflow types** (append at the end of the file)

```ts
// ---------------------------------------------------------------------------
// Workflow / escalation rules
// ---------------------------------------------------------------------------

export type TriggerType = 'ask_for_human' | 'low_confidence' | 'bot_replies' | 'keyword' | 'off_hours'

export type WorkflowTrigger =
  | { type: 'ask_for_human'; phrases: string[] }
  | { type: 'low_confidence' }
  | { type: 'bot_replies'; count: number }
  | { type: 'keyword'; keywords: string[] }
  | { type: 'off_hours'; timezone: string; days: number[]; start: string; end: string }

export interface WorkflowAction {
  type: 'escalate'
  handoffMessage?: string
}

/** API↔web contract for a rule (no timestamps). */
export interface WorkflowRule {
  id: string
  name: string
  enabled: boolean
  order: number
  trigger: WorkflowTrigger
  action: WorkflowAction
}

/** Inputs the engine evaluates for one bot turn. */
export interface EscalationContext {
  messageLower: string
  botReplyCount: number
  sourceCount: number
  now: Date
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @ayooda/shared typecheck && pnpm --filter @ayooda/shared build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): workflow rule types + waiting conversation status"
```

---

### Task 2: Rules engine (pure)

**Files:**
- Create: `apps/api/src/lib/workflow/engine.ts`
- Test: `apps/api/src/lib/workflow/engine.test.ts`

**Interfaces:**
- Consumes: `WorkflowTrigger`, `WorkflowRule`, `EscalationContext` (Task 1).
- Produces: `matchesTrigger(trigger: WorkflowTrigger, ctx: EscalationContext): boolean`; `evaluateRules(rules: WorkflowRule[], ctx: EscalationContext): WorkflowRule | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/workflow/engine.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { matchesTrigger, evaluateRules } from './engine'
import type { WorkflowRule, EscalationContext } from '@ayooda/shared'

const ctx = (over: Partial<EscalationContext> = {}): EscalationContext => ({
  messageLower: 'hello', botReplyCount: 0, sourceCount: 3, now: new Date('2026-08-03T12:00:00Z'), ...over,
})

describe('matchesTrigger', () => {
  test('ask_for_human matches a phrase substring (case-insensitive)', () => {
    const t = { type: 'ask_for_human', phrases: ['talk to a human', 'agent'] } as const
    expect(matchesTrigger(t, ctx({ messageLower: 'can i talk to a human please' }))).toBe(true)
    expect(matchesTrigger(t, ctx({ messageLower: 'what are your hours' }))).toBe(false)
  })
  test('low_confidence fires only when there are 0 sources', () => {
    expect(matchesTrigger({ type: 'low_confidence' }, ctx({ sourceCount: 0 }))).toBe(true)
    expect(matchesTrigger({ type: 'low_confidence' }, ctx({ sourceCount: 1 }))).toBe(false)
  })
  test('bot_replies fires at or above the count', () => {
    expect(matchesTrigger({ type: 'bot_replies', count: 3 }, ctx({ botReplyCount: 3 }))).toBe(true)
    expect(matchesTrigger({ type: 'bot_replies', count: 3 }, ctx({ botReplyCount: 2 }))).toBe(false)
  })
  test('keyword matches any keyword substring', () => {
    const t = { type: 'keyword', keywords: ['refund', 'cancel'] } as const
    expect(matchesTrigger(t, ctx({ messageLower: 'i want a refund' }))).toBe(true)
    expect(matchesTrigger(t, ctx({ messageLower: 'thanks!' }))).toBe(false)
  })
  test('off_hours respects the timezone', () => {
    const base = { type: 'off_hours', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' } as const
    // 12:00 UTC is inside 09–17 in UTC → open → does not fire
    expect(matchesTrigger({ ...base, timezone: 'UTC' }, ctx())).toBe(false)
    // Same instant is 08:00 in New York (EDT, UTC-4) → before 09:00 → closed → fires
    expect(matchesTrigger({ ...base, timezone: 'America/New_York' }, ctx())).toBe(true)
  })
  test('off_hours with no open days is always closed', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'UTC', days: [], start: '09:00', end: '17:00' }, ctx())).toBe(true)
  })
  test('off_hours fires outside the window', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' }, ctx({ now: new Date('2026-08-03T20:00:00Z') }))).toBe(true)
  })
  test('off_hours with a bad timezone never fires', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'Not/AZone', days: [], start: '09:00', end: '17:00' }, ctx())).toBe(false)
  })
})

describe('evaluateRules', () => {
  const rule = (over: Partial<WorkflowRule>): WorkflowRule => ({
    id: 'r', name: 'r', enabled: true, order: 0, trigger: { type: 'low_confidence' }, action: { type: 'escalate' }, ...over,
  })
  test('returns the first enabled rule (by order) that matches', () => {
    const rules = [
      rule({ id: 'b', order: 1, trigger: { type: 'keyword', keywords: ['refund'] } }),
      rule({ id: 'a', order: 0, trigger: { type: 'low_confidence' } }),
    ]
    expect(evaluateRules(rules, ctx({ sourceCount: 0, messageLower: 'refund' }))?.id).toBe('a')
  })
  test('skips disabled rules', () => {
    const rules = [rule({ id: 'a', enabled: false, trigger: { type: 'low_confidence' } })]
    expect(evaluateRules(rules, ctx({ sourceCount: 0 }))).toBeNull()
  })
  test('returns null when nothing matches', () => {
    expect(evaluateRules([rule({ trigger: { type: 'low_confidence' } })], ctx({ sourceCount: 2 }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/workflow/engine.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/workflow/engine.ts`:

```ts
import type { WorkflowTrigger, WorkflowRule, EscalationContext } from '@ayooda/shared'

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n))
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Local weekday (0–6) + minutes-since-midnight for `now` in `timezone`. Throws on a bad timezone. */
function localParts(now: Date, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { day: DAY_INDEX[weekday] ?? 0, minutes: hour * 60 + minute }
}

export function matchesTrigger(trigger: WorkflowTrigger, ctx: EscalationContext): boolean {
  switch (trigger.type) {
    case 'ask_for_human':
      return trigger.phrases.some((p) => p.trim() && ctx.messageLower.includes(p.toLowerCase()))
    case 'keyword':
      return trigger.keywords.some((k) => k.trim() && ctx.messageLower.includes(k.toLowerCase()))
    case 'low_confidence':
      return ctx.sourceCount === 0
    case 'bot_replies':
      return ctx.botReplyCount >= trigger.count
    case 'off_hours': {
      try {
        const { day, minutes } = localParts(ctx.now, trigger.timezone)
        const open = trigger.days.includes(day) && minutes >= toMinutes(trigger.start) && minutes < toMinutes(trigger.end)
        return !open
      } catch {
        return false // bad timezone → never fire
      }
    }
    default:
      return false
  }
}

export function evaluateRules(rules: WorkflowRule[], ctx: EscalationContext): WorkflowRule | null {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order)
  for (const rule of ordered) {
    if (matchesTrigger(rule.trigger, ctx)) return rule
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/workflow/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/workflow/engine.ts apps/api/src/lib/workflow/engine.test.ts
git commit -m "feat(api): pure escalation rules engine"
```

---

### Task 3: Rule validation (pure)

**Files:**
- Create: `apps/api/src/lib/workflow/validate.ts`
- Test: `apps/api/src/lib/workflow/validate.test.ts`

**Interfaces:**
- Consumes: `TriggerType`, `WorkflowTrigger`, `WorkflowAction` (Task 1).
- Produces: `ValidatedRule = { name; enabled; trigger: WorkflowTrigger; action: WorkflowAction }`; `validateRule(raw: unknown): { ok: true; value: ValidatedRule } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/workflow/validate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { validateRule } from './validate'

const base = { name: 'Ask for human', enabled: true, action: { type: 'escalate', handoffMessage: 'Hold on' } }

describe('validateRule', () => {
  test('accepts an ask_for_human rule', () => {
    const r = validateRule({ ...base, trigger: { type: 'ask_for_human', phrases: ['human', 'agent'] } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.trigger.type).toBe('ask_for_human')
  })
  test('accepts a bot_replies rule and coerces enabled default', () => {
    const r = validateRule({ name: 'N', action: { type: 'escalate' }, trigger: { type: 'bot_replies', count: 3 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.enabled).toBe(true)
  })
  test('rejects a bad trigger type', () => {
    expect(validateRule({ ...base, trigger: { type: 'nope' } }).ok).toBe(false)
  })
  test('rejects bot_replies with a non-positive count', () => {
    expect(validateRule({ ...base, trigger: { type: 'bot_replies', count: 0 } }).ok).toBe(false)
  })
  test('rejects ask_for_human with no phrases', () => {
    expect(validateRule({ ...base, trigger: { type: 'ask_for_human', phrases: [] } }).ok).toBe(false)
  })
  test('rejects off_hours with a bad timezone', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'Bad/Zone', days: [1], start: '09:00', end: '17:00' } }).ok).toBe(false)
  })
  test('accepts a valid off_hours rule', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } }).ok).toBe(true)
  })
  test('rejects a bad start time format', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'UTC', days: [1], start: '9am', end: '17:00' } }).ok).toBe(false)
  })
  test('rejects an over-length handoff message', () => {
    expect(validateRule({ name: 'N', action: { type: 'escalate', handoffMessage: 'x'.repeat(501) }, trigger: { type: 'low_confidence' } }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/workflow/validate.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/workflow/validate.ts`:

```ts
import type { TriggerType, WorkflowTrigger, WorkflowAction } from '@ayooda/shared'

export interface ValidatedRule {
  name: string
  enabled: boolean
  trigger: WorkflowTrigger
  action: WorkflowAction
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

const TRIGGER_TYPES: TriggerType[] = ['ask_for_human', 'low_confidence', 'bot_replies', 'keyword', 'off_hours']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

function cleanStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
}

function validateTrigger(raw: unknown): { ok: true; value: WorkflowTrigger } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Trigger is required.')
  const t = raw as Record<string, unknown>
  const type = t.type as TriggerType
  if (!TRIGGER_TYPES.includes(type)) return fail('Unknown trigger type.')
  switch (type) {
    case 'ask_for_human': {
      const phrases = cleanStrings(t.phrases)
      if (phrases.length < 1 || phrases.length > 20) return fail('Add 1–20 phrases.')
      return { ok: true, value: { type, phrases } }
    }
    case 'keyword': {
      const keywords = cleanStrings(t.keywords)
      if (keywords.length < 1 || keywords.length > 20) return fail('Add 1–20 keywords.')
      return { ok: true, value: { type, keywords } }
    }
    case 'low_confidence':
      return { ok: true, value: { type } }
    case 'bot_replies': {
      const count = Number(t.count)
      if (!Number.isInteger(count) || count < 1 || count > 50) return fail('Count must be 1–50.')
      return { ok: true, value: { type, count } }
    }
    case 'off_hours': {
      const timezone = typeof t.timezone === 'string' ? t.timezone : ''
      if (!validTimezone(timezone)) return fail('Invalid timezone.')
      const days = Array.isArray(t.days) ? t.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []
      const start = typeof t.start === 'string' ? t.start : ''
      const end = typeof t.end === 'string' ? t.end : ''
      if (!HHMM.test(start) || !HHMM.test(end)) return fail('Times must be HH:MM (24h).')
      return { ok: true, value: { type, timezone, days: [...new Set(days)], start, end } }
    }
    default:
      return fail('Unknown trigger type.')
  }
}

export function validateRule(raw: unknown): { ok: true; value: ValidatedRule } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Invalid request body.')
  const o = raw as Record<string, unknown>

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name.length < 1 || name.length > 80) return fail('Name must be 1–80 characters.')

  const enabled = o.enabled === undefined ? true : o.enabled === true

  const trig = validateTrigger(o.trigger)
  if (!trig.ok) return trig

  const rawAction = (o.action ?? {}) as Record<string, unknown>
  if (rawAction.type !== 'escalate') return fail('Action must be "escalate".')
  const handoffMessage = typeof rawAction.handoffMessage === 'string' ? rawAction.handoffMessage.trim() : undefined
  if (handoffMessage !== undefined && handoffMessage.length > 500) return fail('Handoff message is too long (max 500).')
  const action: WorkflowAction = { type: 'escalate', ...(handoffMessage ? { handoffMessage } : {}) }

  return { ok: true, value: { name, enabled, trigger: trig.value, action } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/workflow/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/workflow/validate.ts apps/api/src/lib/workflow/validate.test.ts
git commit -m "feat(api): workflow rule validation"
```

---

### Task 4: `prepareTurn` — silence guard, escalation, botReplyCount

**Files:**
- Modify: `apps/api/src/lib/chat/agent-turn.ts`

**Interfaces:**
- Consumes: `evaluateRules` (Task 2); `WorkflowRule` (Task 1).
- Produces: `PreparedTurn` gains `{ kind: 'silent' }` and `{ kind: 'escalated'; message: string }`.

- [ ] **Step 1: Add imports + the new union members**

In `apps/api/src/lib/chat/agent-turn.ts`, add to the imports:

```ts
import { evaluateRules } from '../workflow/engine'
import type { WorkflowRule } from '@ayooda/shared'
```

Extend the `PreparedTurn` union:

```ts
export type PreparedTurn =
  | { kind: 'gated'; reason: GateReason }
  | { kind: 'error'; error: string }
  | { kind: 'silent' }
  | { kind: 'escalated'; message: string }
  | ReadyTurn

const DEFAULT_HANDOFF = 'Let me connect you with someone from our team.'
```

- [ ] **Step 2: Add the silence guard** (after the existing visitor-id check)

Replace:

```ts
  const convSnap = await convRef.get()
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return { kind: 'error', error: 'Not found' }
  }
```

with:

```ts
  const convSnap = await convRef.get()
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return { kind: 'error', error: 'Not found' }
  }

  // Silence guard: a conversation a human owns/queued never gets a bot reply.
  if (convSnap.exists && convSnap.data()!.status && convSnap.data()!.status !== 'bot') {
    await convRef.collection('messages').add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })
    await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: trimmed.slice(0, 200) })
    return { kind: 'silent' }
  }
```

- [ ] **Step 3: Add the escalation branch** (immediately after the RAG block, before `// Key resolution`)

Insert after the RAG `try/catch` that sets `sources`/`contextBlocks`:

```ts
  // Escalation rules (non-fatal): evaluate after RAG so low-confidence is known.
  try {
    const rulesSnap = await adminDb.collection(`workspaces/${workspaceId}/workflowRules`).where('enabled', '==', true).get()
    const rules: WorkflowRule[] = rulesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkflowRule, 'id'>) }))
    const hit = evaluateRules(rules, {
      messageLower: trimmed.toLowerCase(),
      botReplyCount: (convSnap.exists ? convSnap.data()!.botReplyCount : 0) ?? 0,
      sourceCount: sources.length,
      now: new Date(),
    })
    if (hit) {
      const handoff = hit.action.handoffMessage?.trim() || DEFAULT_HANDOFF
      await messagesRef.add({ role: 'assistant', content: handoff, createdAt: FieldValue.serverTimestamp(), metadata: { escalated: true } })
      await convRef.update({ status: 'waiting', escalationReason: hit.name, operatorId: null, updatedAt: FieldValue.serverTimestamp(), lastMessage: handoff.slice(0, 200) })
      await workspaceRef.update({ 'usage.messageCount': FieldValue.increment(2) }).catch(() => {})
      trace.update({ output: { escalated: hit.name } })
      return { kind: 'escalated', message: handoff }
    }
  } catch (err) {
    console.warn('[agent-turn] escalation check failed:', err)
  }
```

- [ ] **Step 4: Increment `botReplyCount` in `persist`**

In the `persist` closure, change the conversation update:

```ts
      await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200) })
```

to:

```ts
      await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200), botReplyCount: FieldValue.increment(1) })
```

- [ ] **Step 5: Typecheck + build + full api tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/chat/agent-turn.ts
git commit -m "feat(api): escalation + silence guard in prepareTurn"
```

---

### Task 5: Channel callers — deliver handoff / stay silent

**Files:**
- Modify: `apps/api/src/routes/widget.ts`
- Modify: `apps/api/src/routes/telegram.ts`

**Interfaces:**
- Consumes: `PreparedTurn` kinds `silent` / `escalated` (Task 4).

- [ ] **Step 1: Widget — handle the new kinds**

In `apps/api/src/routes/widget.ts`, after the `gated` and `error` handling and **before** `const { chatParams, sources, trace, llmModel, tools, persist } = prepared`, add:

```ts
  if (prepared.kind === 'silent') {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, sources: [] }) })
    })
  }
  if (prepared.kind === 'escalated') {
    const message = prepared.message
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: message }) })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ conversationId, sources: [] }) })
    })
  }
```

- [ ] **Step 2: Telegram — broaden silence + handle escalated**

In `apps/api/src/routes/telegram.ts`, change the human-silence pre-check:

```ts
      if (convSnap.exists && convSnap.data()!.status === 'human') {
```

to:

```ts
      if (convSnap.exists && convSnap.data()!.status !== 'bot') {
```

Then, after the `prepared.kind === 'error'` handling and **before** the `const gen = runAgentTurn(...)` line, add:

```ts
      if (prepared.kind === 'silent') {
        return c.json({ ok: true })
      }
      if (prepared.kind === 'escalated') {
        await sendMessage(token, chatId, prepared.message)
        return c.json({ ok: true })
      }
```

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS (both callers now exhaustively handle the union before using `ReadyTurn`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/widget.ts apps/api/src/routes/telegram.ts
git commit -m "feat(api): widget + telegram deliver handoff / stay silent on escalation"
```

---

### Task 6: `/workflows` route

**Files:**
- Create: `apps/api/src/routes/workflows.ts`
- Modify: `apps/api/src/index.ts` (mount `/workflows`)

**Interfaces:**
- Consumes: `requireAuth`, `requireOwner`, `AuthVariables`; `validateRule` (Task 3); `WorkflowRule` (Task 1); `adminDb`.
- Produces: a Hono router at `/workflows` with `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `PUT /reorder`.

- [ ] **Step 1: Implement the route**

Create `apps/api/src/routes/workflows.ts`:

```ts
import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { validateRule } from '../lib/workflow/validate'
import type { WorkflowRule } from '@ayooda/shared'

const workflows = new Hono<{ Variables: AuthVariables }>()
workflows.use('*', requireAuth)
workflows.use('*', requireOwner)

function toRule(id: string, d: DocumentData): WorkflowRule {
  return { id, name: d.name, enabled: d.enabled !== false, order: d.order ?? 0, trigger: d.trigger, action: d.action }
}

/** GET /workflows — list rules ordered by `order`. */
workflows.get('/', async (c) => {
  const ws = c.get('workspaceId')
  const snap = await adminDb.collection(`workspaces/${ws}/workflowRules`).orderBy('order', 'asc').get()
  return c.json({ rules: snap.docs.map((d) => toRule(d.id, d.data())) })
})

/** POST /workflows — create a rule at the end of the list. */
workflows.post('/', async (c) => {
  const ws = c.get('workspaceId')
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  const col = adminDb.collection(`workspaces/${ws}/workflowRules`)
  const existing = await col.orderBy('order', 'desc').limit(1).get()
  const nextOrder = existing.empty ? 0 : (existing.docs[0]!.data().order ?? 0) + 1
  const now = new Date()
  const doc = { ...result.value, order: nextOrder, createdAt: now, updatedAt: now }
  const ref = await col.add(doc)
  return c.json(toRule(ref.id, doc))
})

/** PUT /workflows/reorder { orderedIds } — set each rule's order to its index.
 *  Declared BEFORE the `/:id` routes so the literal segment always wins. */
workflows.put('/reorder', async (c) => {
  const ws = c.get('workspaceId')
  const body = await c.req.json<{ orderedIds?: string[] }>().catch(() => ({} as { orderedIds?: string[] }))
  const ids = Array.isArray(body.orderedIds) ? body.orderedIds : []
  const col = adminDb.collection(`workspaces/${ws}/workflowRules`)
  const existing = new Set((await col.get()).docs.map((d) => d.id))
  const batch = adminDb.batch()
  ids.forEach((id, i) => { if (existing.has(id)) batch.update(col.doc(id), { order: i, updatedAt: new Date() }) })
  await batch.commit()
  return c.json({ ok: true })
})

/** PUT /workflows/:id — update a rule. */
workflows.put('/:id', async (c) => {
  const ws = c.get('workspaceId')
  const ref = adminDb.doc(`workspaces/${ws}/workflowRules/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Rule not found' }, 404)
  const result = validateRule(await c.req.json().catch(() => null))
  if (!result.ok) return c.json({ error: result.error }, 400)
  await ref.update({ ...result.value, updatedAt: new Date() })
  return c.json(toRule(ref.id, { ...snap.data(), ...result.value }))
})

/** DELETE /workflows/:id — idempotent. */
workflows.delete('/:id', async (c) => {
  const ws = c.get('workspaceId')
  await adminDb.doc(`workspaces/${ws}/workflowRules/${c.req.param('id')}`).delete()
  return c.json({ ok: true })
})

export default workflows
```

- [ ] **Step 2: Mount in index.ts**

Add `import workflowRoutes from './routes/workflows'` with the other imports, and mount it near the other authed routes:

```ts
app.route('/workflows', workflowRoutes)
```

- [ ] **Step 3: Typecheck + build + mount check**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && grep -c "workflowRoutes" src/index.ts`
Expected: PASS; `2` matches.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/workflows.ts apps/api/src/index.ts
git commit -m "feat(api): owner-only /workflows CRUD + reorder"
```

---

### Task 7: Inbox — Waiting filter + takeover

**Files:**
- Modify: `apps/web/src/app/dashboard/inbox/page.tsx`

**Interfaces:**
- Consumes: the `waiting` status + `escalationReason` (Task 1).

- [ ] **Step 1: Add `waiting` to the conversation type + style**

In `apps/web/src/app/dashboard/inbox/page.tsx`, change the `Conversation` interface `status` field to:

```ts
  status: 'bot' | 'waiting' | 'human' | 'resolved'
```

and add `escalationReason?: string` to the interface. Add a `waiting` entry to `STATUS_STYLE`:

```ts
const STATUS_STYLE: Record<Conversation['status'], React.CSSProperties> = {
  bot: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  waiting: { background: 'rgba(239,68,68,0.15)', color: '#f87171' },
  human: { background: 'rgba(245,165,36,0.18)', color: '#ffd27a' },
  resolved: { background: 'var(--panel-2)', color: 'var(--ink-mute)' },
}
```

- [ ] **Step 2: Add a client-side status filter**

Add filter state near the other `useState` hooks:

```ts
  const [filter, setFilter] = useState<'all' | 'waiting' | 'human' | 'bot' | 'resolved'>('all')
```

Derive the filtered list where the conversation list is rendered (replace the `conversations.map(...)` source with a filtered array):

```ts
  const visibleConversations = filter === 'all' ? conversations : conversations.filter((c) => c.status === filter)
```

Render a filter bar directly above the conversation list (inside the left column, before the list `.map`):

```tsx
  <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
    {(['all', 'waiting', 'human', 'bot', 'resolved'] as const).map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => setFilter(f)}
        style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
          border: '1px solid var(--line)', textTransform: 'capitalize',
          background: filter === f ? 'var(--accent-soft)' : 'transparent',
          color: filter === f ? 'var(--accent)' : 'var(--ink-mute)',
        }}
      >
        {f}
      </button>
    ))}
  </div>
```

Change the list rendering to iterate `visibleConversations` instead of `conversations`.

- [ ] **Step 3: Show the escalation reason + allow takeover for waiting**

In the thread header, under the `Status:` line, add the reason when present:

```tsx
              {selectedConv.status === 'waiting' && selectedConv.escalationReason && (
                <p style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>Escalated: {selectedConv.escalationReason}</p>
              )}
```

Change the Take-over button condition so it also shows for `waiting`:

```tsx
              {(selectedConv.status === 'bot' || selectedConv.status === 'waiting') && (
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/inbox/page.tsx
git commit -m "feat(web): inbox Waiting filter + escalation reason + takeover"
```

---

### Task 8: Web — Workflows page + nav

**Files:**
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx` (add Workflows link)
- Create: `apps/web/src/app/dashboard/workflows/page.tsx`

**Interfaces:**
- Consumes: `apiRequest`; `/workflows` endpoints; `WorkflowRule`, `WorkflowTrigger`, `TriggerType` (Task 1).

- [ ] **Step 1: Add the nav link (owner-only)**

In `apps/web/src/components/dashboard/Sidebar.tsx`, add `GitBranch` to the `lucide-react` import, and add a nav item to `navItems` (already hidden for members):

```ts
  { label: 'Tools', href: '/dashboard/tools', icon: Wrench },
  { label: 'Workflows', href: '/dashboard/workflows', icon: GitBranch },
```

- [ ] **Step 2: Create the Workflows page**

Create `apps/web/src/app/dashboard/workflows/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { WorkflowRule, WorkflowTrigger, TriggerType } from '@ayooda/shared'

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }
const label: React.CSSProperties = { fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }
const input: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--ink)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

const TRIGGER_LABELS: Record<TriggerType, string> = {
  ask_for_human: 'Visitor asks for a human',
  low_confidence: 'Low knowledge confidence',
  bot_replies: 'After N bot replies',
  keyword: 'Message contains a keyword',
  off_hours: 'Outside business hours',
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Editor {
  id: string | null
  name: string
  enabled: boolean
  type: TriggerType
  phrases: string
  keywords: string
  count: number
  timezone: string
  days: number[]
  start: string
  end: string
  handoffMessage: string
}

function emptyEditor(): Editor {
  return {
    id: null, name: '', enabled: true, type: 'ask_for_human',
    phrases: 'human, agent, talk to a person', keywords: 'refund, cancel', count: 3,
    timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', handoffMessage: '',
  }
}

function triggerSummary(t: WorkflowTrigger): string {
  switch (t.type) {
    case 'ask_for_human': return `asks for a human (${t.phrases.length} phrases)`
    case 'keyword': return `keyword (${t.keywords.join(', ')})`
    case 'low_confidence': return 'low knowledge confidence'
    case 'bot_replies': return `after ${t.count} bot replies`
    case 'off_hours': return `off-hours (${t.timezone})`
  }
}

function editorToTrigger(e: Editor): WorkflowTrigger {
  switch (e.type) {
    case 'ask_for_human': return { type: 'ask_for_human', phrases: e.phrases.split(',').map((s) => s.trim()).filter(Boolean) }
    case 'keyword': return { type: 'keyword', keywords: e.keywords.split(',').map((s) => s.trim()).filter(Boolean) }
    case 'low_confidence': return { type: 'low_confidence' }
    case 'bot_replies': return { type: 'bot_replies', count: Number(e.count) }
    case 'off_hours': return { type: 'off_hours', timezone: e.timezone.trim(), days: e.days, start: e.start, end: e.end }
  }
}

function ruleToEditor(r: WorkflowRule): Editor {
  const e = emptyEditor()
  e.id = r.id; e.name = r.name; e.enabled = r.enabled; e.type = r.trigger.type
  e.handoffMessage = r.action.handoffMessage ?? ''
  const t = r.trigger
  if (t.type === 'ask_for_human') e.phrases = t.phrases.join(', ')
  if (t.type === 'keyword') e.keywords = t.keywords.join(', ')
  if (t.type === 'bot_replies') e.count = t.count
  if (t.type === 'off_hours') { e.timezone = t.timezone; e.days = t.days; e.start = t.start; e.end = t.end }
  return e
}

export default function WorkflowsPage() {
  const [rules, setRules] = useState<WorkflowRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/workflows')
      if (res.ok) { const d = await res.json() as { rules: WorkflowRule[] }; setRules(d.rules) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    const payload = { name: editor.name.trim(), enabled: editor.enabled, trigger: editorToTrigger(editor), action: { type: 'escalate', ...(editor.handoffMessage.trim() ? { handoffMessage: editor.handoffMessage.trim() } : {}) } }
    try {
      const res = editor.id
        ? await apiRequest(`/workflows/${editor.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiRequest('/workflows', { method: 'POST', body: JSON.stringify(payload) })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not save the rule'); return }
      setEditor(null); await load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    setBusyId(id)
    try { await apiRequest(`/workflows/${id}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...rules]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    setRules(next)
    await apiRequest('/workflows/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds: next.map((r) => r.id) }) })
    await load()
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Workflows</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Rules that hand a conversation to a human. Evaluated top-to-bottom each bot reply — the first match wins.</p>
        </div>
        {!editor && <button type="button" onClick={() => { setEditor(emptyEditor()); setError('') }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px' }}><Plus size={14} /> New rule</button>}
      </div>

      {error && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{error}</p>}

      {!editor && (
        <div style={card}>
          <p style={label}>Your rules</p>
          {rules.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No rules yet. Add one to auto-escalate conversations.</p>}
          {rules.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" onClick={() => void move(i, -1)} disabled={i === 0} aria-label="Up" style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--ink-mute)', opacity: i === 0 ? 0.3 : 1, padding: 0 }}><ArrowUp size={13} /></button>
                <button type="button" onClick={() => void move(i, 1)} disabled={i === rules.length - 1} aria-label="Down" style={{ background: 'none', border: 'none', cursor: i === rules.length - 1 ? 'default' : 'pointer', color: 'var(--ink-mute)', opacity: i === rules.length - 1 ? 0.3 : 1, padding: 0 }}><ArrowDown size={13} /></button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{r.name}{!r.enabled && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}> · disabled</span>}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{triggerSummary(r.trigger)}</p>
              </div>
              <button type="button" onClick={() => { setEditor(ruleToEditor(r)); setError('') }} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13 }}>Edit</button>
              <button type="button" onClick={() => void remove(r.id)} disabled={busyId === r.id} aria-label="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>{busyId === r.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}</button>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <div style={card}>
          <p style={label}>{editor.id ? 'Edit rule' : 'New rule'}</p>
          <div style={{ marginBottom: 12 }}><input placeholder="Rule name" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} style={input} /></div>

          <p style={{ ...label, marginTop: 16 }}>When (trigger)</p>
          <select value={editor.type} onChange={(e) => setEditor({ ...editor, type: e.target.value as TriggerType })} style={input}>
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
          </select>

          <div style={{ marginTop: 12 }}>
            {editor.type === 'ask_for_human' && <textarea placeholder="Comma-separated phrases" value={editor.phrases} onChange={(e) => setEditor({ ...editor, phrases: e.target.value })} style={{ ...input, minHeight: 48, resize: 'vertical' }} />}
            {editor.type === 'keyword' && <textarea placeholder="Comma-separated keywords" value={editor.keywords} onChange={(e) => setEditor({ ...editor, keywords: e.target.value })} style={{ ...input, minHeight: 48, resize: 'vertical' }} />}
            {editor.type === 'low_confidence' && <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Escalates when the knowledge base returns no confident match.</p>}
            {editor.type === 'bot_replies' && <input type="number" min={1} max={50} value={editor.count} onChange={(e) => setEditor({ ...editor, count: Number(e.target.value) })} style={{ ...input, width: 120 }} />}
            {editor.type === 'off_hours' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input placeholder="Timezone (e.g. America/New_York)" value={editor.timezone} onChange={(e) => setEditor({ ...editor, timezone: e.target.value })} style={input} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAY_NAMES.map((d, i) => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-mute)' }}>
                      <input type="checkbox" checked={editor.days.includes(i)} onChange={(e) => setEditor({ ...editor, days: e.target.checked ? [...editor.days, i] : editor.days.filter((x) => x !== i) })} /> {d}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Open</span>
                  <input type="time" value={editor.start} onChange={(e) => setEditor({ ...editor, start: e.target.value })} style={{ ...input, width: 130 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>to</span>
                  <input type="time" value={editor.end} onChange={(e) => setEditor({ ...editor, end: e.target.value })} style={{ ...input, width: 130 }} />
                </div>
              </div>
            )}
          </div>

          <p style={{ ...label, marginTop: 16 }}>Handoff message (optional)</p>
          <input placeholder="Let me connect you with someone from our team." value={editor.handoffMessage} onChange={(e) => setEditor({ ...editor, handoffMessage: e.target.value })} style={input} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-mute)', marginTop: 16 }}>
            <input type="checkbox" checked={editor.enabled} onChange={(e) => setEditor({ ...editor, enabled: e.target.checked })} /> Enabled
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>{saving ? 'Saving…' : 'Save rule'}</button>
            <button type="button" onClick={() => setEditor(null)} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '10px 18px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS; `/dashboard/workflows` in the route list.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dashboard/Sidebar.tsx apps/web/src/app/dashboard/workflows/page.tsx
git commit -m "feat(web): Workflows page (rule list/editor/reorder) + nav"
```

---

## Live E2E (after all tasks — from the spec §10)

Against the dev API + a real workspace with a widget:

1. **ask_for_human:** create a rule; send "can I talk to a human" → the visitor gets the handoff message, the conversation shows in the inbox **Waiting** filter with the escalation reason, and no LLM answer is generated.
2. **low_confidence:** a rule + an off-topic question with no knowledge match → escalates.
3. **bot_replies:** a rule with count 2 → after 2 bot replies, the 3rd visitor turn escalates.
4. **keyword** and **off_hours:** each escalates when its condition holds (set an off-hours window covering "now").
5. **Silence + takeover:** after escalation, further visitor messages get no bot reply (saved only); the operator clicks **Take over** (waiting → human) and can reply; on Telegram the same conversation escalates and stays silent.
6. **Owner gate:** a member session 403s on `/workflows`.

Clean up test rules/conversations.

## Out of scope (v1)

Visual node-graph builder; routing-to-agent and auto-reply actions; multi-step/branching flows; email/push notifications; per-agent rules; LLM-based intent detection; SLA timers / auto-resolve; escalation analytics.
