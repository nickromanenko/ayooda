# Metered Overage Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let paying subscribers exceed their included conversation pack and bill the overage at $0.05/conversation via Stripe metered billing, with a 10× per-plan safety ceiling — instead of hard-gating at the included cap.

**Architecture:** `checkEntitlement` stops hard-gating active subscribers at the included cap; it returns `includedCap`/`ceiling`/`overage` and only gates at `10 × includedCap` (`ceiling_reached`). A Stripe Billing Meter + a shared $0.05 metered price is added as a second subscription item; `prepareTurn` emits one meter event per over-cap conversation (idempotent by `conversationId`, non-fatal). The Billing page surfaces the overage count + estimate.

**Tech Stack:** Bun + Hono (api), Stripe SDK (Billing Meters API, pinned `2026-06-24.dahlia`), Firestore, `@ayooda/shared`, Next.js Billing page. Tests: `bun test`.

## Global Constraints

- **Overage rate `OVERAGE_RATE_USD = 0.05`; ceiling `OVERAGE_CEILING_MULTIPLIER = 10`** (both in `@ayooda/shared`). `ceiling = includedCap × 10` (Lite 1,000 / Core 5,000 / Max 15,000).
- **Trials stay hard-capped** at `TRIAL_CONVERSATION_CAP`; canceled/expired unchanged. Only **active/past_due** accrue overage.
- **Meter events are overage-only** (value `1` per conversation beyond `includedCap`), keyed `identifier: conversationId` for idempotency, **fire-and-forget & non-fatal**, and **no-op when billing is unconfigured** (self-host).
- New `GateReason` value **`ceiling_reached`**. `EntitlementResult` replaces `cap` with `includedCap` and adds `ceiling` + `overage`.
- New api env: `STRIPE_PRICE_OVERAGE`, `STRIPE_OVERAGE_METER_EVENT` (default `ayooda_overage_conversations`).
- Web mirrors the existing dashboard idiom; `apps/web/AGENTS.md` — modified Next.js, no new framework APIs.

---

### Task 1: Shared consts + entitlement (includedCap/ceiling/overage)

**Files:**
- Modify: `packages/shared/src/index.ts` (add consts)
- Modify: `apps/api/src/lib/billing/entitlement.ts`
- Modify: `apps/api/src/lib/billing/entitlement.test.ts`
- Modify: `apps/api/src/routes/billing.ts:110` (minimal caller fix: `cap: ent.cap` → `cap: ent.includedCap`)

**Interfaces:**
- Consumes: `planFor`, `TRIAL_CONVERSATION_CAP`, `PlanTier`, `Subscription` (shared).
- Produces: `OVERAGE_RATE_USD`, `OVERAGE_CEILING_MULTIPLIER` (shared); `GateReason` incl. `'ceiling_reached'`; `EntitlementResult { entitled; reason; includedCap; ceiling; overage; tier }`.

- [ ] **Step 1: Add shared consts**

In `packages/shared/src/index.ts`, next to `TRIAL_DAYS`/`TRIAL_CONVERSATION_CAP`, add:

```ts
export const OVERAGE_RATE_USD = 0.05
export const OVERAGE_CEILING_MULTIPLIER = 10
```

Build shared: `pnpm --filter @ayooda/shared build`

- [ ] **Step 2: Update the failing tests**

Replace the two `toEqual` assertions and add overage/ceiling cases in `apps/api/src/lib/billing/entitlement.test.ts`:

```ts
  test('active subscription under included cap → entitled, no overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'core' }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date() })
    expect(r).toEqual({ entitled: true, reason: 'ok', includedCap: 500, ceiling: 5000, overage: false, tier: 'core' })
  })
  test('active subscription at/over included cap but under ceiling → entitled + overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'lite' }), periodConversationCount: 100, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.overage).toBe(true); expect(r.includedCap).toBe(100); expect(r.ceiling).toBe(1000)
  })
  test('active subscription at the ceiling → ceiling_reached', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'lite' }), periodConversationCount: 1000, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('ceiling_reached'); expect(r.overage).toBe(false)
  })
  test('past_due at/over cap under ceiling → entitled + overage (grace)', () => {
    const r = checkEntitlement({ subscription: base({ status: 'past_due', tier: 'lite' }), periodConversationCount: 150, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.reason).toBe('past_due'); expect(r.overage).toBe(true)
  })
  test('trial active under trial cap → entitled, no overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date('2026-01-10T00:00:00Z') })
    expect(r).toEqual({ entitled: true, reason: 'ok', includedCap: 50, ceiling: 50, overage: false, tier: null })
  })
```

(Replace the old `active subscription over cap → over_cap` test and the old `trial active under trial cap` `toEqual` with the versions above; keep the other tests — but update the `past_due still entitled but flagged` test to also `expect(r.overage).toBe(false)` at `periodConversationCount: 5`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && bun test src/lib/billing/entitlement.test.ts`
Expected: FAIL (shape mismatch — `includedCap`/`ceiling`/`overage` not present).

- [ ] **Step 4: Rewrite `checkEntitlement`**

In `apps/api/src/lib/billing/entitlement.ts`:

```ts
import { planFor, TRIAL_CONVERSATION_CAP, OVERAGE_CEILING_MULTIPLIER, type Subscription, type PlanTier } from '@ayooda/shared'

export type GateReason = 'ok' | 'trial_expired' | 'no_subscription' | 'over_cap' | 'past_due' | 'ceiling_reached'

export interface EntitlementInput {
  subscription: Subscription | undefined
  periodConversationCount: number
  workspaceCreatedAt: Date
  now: Date
}

export interface EntitlementResult {
  entitled: boolean
  reason: GateReason
  includedCap: number
  ceiling: number
  overage: boolean
  tier: PlanTier | null
}

export function checkEntitlement(input: EntitlementInput): EntitlementResult {
  const { subscription: sub, periodConversationCount: used, now } = input
  const status = sub?.status ?? 'expired'

  if (status === 'active' || status === 'past_due') {
    const s = sub as Subscription
    const plan = planFor(s.tier)
    const reason: GateReason = status === 'past_due' ? 'past_due' : 'ok'
    // Unknown tier on an active subscription (transient sync): fail open.
    if (!plan) return { entitled: true, reason, includedCap: 0, ceiling: 0, overage: false, tier: s.tier }
    const includedCap = plan.conversationCap
    const ceiling = includedCap * OVERAGE_CEILING_MULTIPLIER
    if (used >= ceiling) return { entitled: false, reason: 'ceiling_reached', includedCap, ceiling, overage: false, tier: s.tier }
    return { entitled: true, reason, includedCap, ceiling, overage: used >= includedCap, tier: s.tier }
  }

  if (status === 'trialing') {
    const ends = sub?.trialEndsAt ?? null
    const includedCap = TRIAL_CONVERSATION_CAP
    if (ends && now >= ends) return { entitled: false, reason: 'trial_expired', includedCap, ceiling: includedCap, overage: false, tier: null }
    if (used >= includedCap) return { entitled: false, reason: 'over_cap', includedCap, ceiling: includedCap, overage: false, tier: null }
    return { entitled: true, reason: 'ok', includedCap, ceiling: includedCap, overage: false, tier: null }
  }

  if (status === 'canceled') return { entitled: false, reason: 'no_subscription', includedCap: 0, ceiling: 0, overage: false, tier: sub?.tier ?? null }
  return { entitled: false, reason: 'trial_expired', includedCap: 0, ceiling: 0, overage: false, tier: null }
}
```

Keep `shouldResetPeriod` unchanged (below the function).

- [ ] **Step 5: Fix the GET /billing caller so the api compiles**

In `apps/api/src/routes/billing.ts`, the `GET /` response line currently reads `entitled: ent.entitled, reason: ent.reason, cap: ent.cap, tier: ent.tier,`. Change `cap: ent.cap` to `cap: ent.includedCap,` (Task 6 expands this; this keeps it compiling and the current web page working).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @ayooda/shared build && cd apps/api && bun test src/lib/billing/entitlement.test.ts && pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/lib/billing/entitlement.ts apps/api/src/lib/billing/entitlement.test.ts apps/api/src/routes/billing.ts
git commit -m "feat(billing): entitlement returns includedCap/ceiling/overage (10x ceiling)"
```

---

### Task 2: Stripe meter + metered overage price (setup script + env)

**Files:**
- Modify: `apps/api/scripts/setup-stripe.ts`
- Modify: `apps/api/.env.example`
- Modify: `docs/self-hosting.md` (billing env note)

**Interfaces:**
- Consumes: `getStripe()`.
- Produces: a Billing Meter (`event_name: ayooda_overage_conversations`) + a shared metered $0.05 price; prints `STRIPE_PRICE_OVERAGE` + `STRIPE_OVERAGE_METER_EVENT`.

- [ ] **Step 1: Extend `setup-stripe.ts`**

After the existing tier-price loop (before `process.exit(0)`), add:

```ts
// ─── Overage: a usage meter + a shared metered $0.05 price ───────────
const EVENT_NAME = 'ayooda_overage_conversations'
const meters = await stripe.billing.meters.list({ limit: 100 })
let meter = meters.data.find((m) => m.event_name === EVENT_NAME && m.status === 'active')
if (!meter) {
  meter = await stripe.billing.meters.create({
    display_name: 'Ayooda overage conversations',
    event_name: EVENT_NAME,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  })
}

let overageProduct = existing.data.find((p) => p.name === 'Ayooda Usage')
if (!overageProduct) overageProduct = await stripe.products.create({ name: 'Ayooda Usage' })
const overagePrices = await stripe.prices.list({ product: overageProduct.id, active: true, limit: 100 })
let overagePrice = overagePrices.data.find((p) => p.recurring?.usage_type === 'metered' && p.unit_amount === 5)
if (!overagePrice) {
  overagePrice = await stripe.prices.create({
    product: overageProduct.id,
    currency: 'usd',
    unit_amount: 5,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
  })
}
console.log(`STRIPE_PRICE_OVERAGE=${overagePrice.id}`)
console.log(`STRIPE_OVERAGE_METER_EVENT=${EVENT_NAME}`)
```

(`existing` is the products list already fetched at the top of the script.)

- [ ] **Step 2: Add env to `apps/api/.env.example`**

In the optional Stripe block, add two lines:

```bash
# STRIPE_PRICE_OVERAGE=price_...                       # metered $0.05/conversation overage price (from setup-stripe.ts)
# STRIPE_OVERAGE_METER_EVENT=ayooda_overage_conversations
```

- [ ] **Step 3: Note the env in the self-hosting doc**

In `docs/self-hosting.md`, in the api env table's `STRIPE_*` row (or just below it), add a sentence: "For usage-based overage, also set `STRIPE_PRICE_OVERAGE` (the metered price from `setup-stripe.ts`) and `STRIPE_OVERAGE_METER_EVENT`."

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. (The script hits Stripe at runtime; it is not executed here — run it at deploy.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/setup-stripe.ts apps/api/.env.example docs/self-hosting.md
git commit -m "feat(billing): create overage meter + metered price in setup-stripe"
```

---

### Task 3: Two-item checkout

**Files:**
- Modify: `apps/api/src/routes/billing.ts` (`POST /checkout`)

**Interfaces:**
- Consumes: `PRICE_BY_TIER`; `process.env.STRIPE_PRICE_OVERAGE`.
- Produces: subscriptions created with both the flat tier price + the metered overage price.

- [ ] **Step 1: Add the overage line item**

In `POST /billing/checkout`, replace the `line_items: [{ price, quantity: 1 }],` in the `checkout.sessions.create` call with a built list:

```ts
  const overagePrice = process.env.STRIPE_PRICE_OVERAGE
  const lineItems: Array<{ price: string; quantity?: number }> = [{ price, quantity: 1 }]
  if (overagePrice) lineItems.push({ price: overagePrice })
  else console.warn('[billing/checkout] STRIPE_PRICE_OVERAGE not set — overage will not be metered')

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: workspaceId,
    line_items: lineItems,
    subscription_data: { metadata: { workspaceId } },
    success_url: process.env.BILLING_SUCCESS_URL!,
    cancel_url: process.env.BILLING_CANCEL_URL!,
  })
```

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/billing.ts
git commit -m "feat(billing): checkout adds the metered overage subscription item"
```

---

### Task 4: `emitOverageEvent` helper + `prepareTurn` wiring

**Files:**
- Create: `apps/api/src/lib/billing/overage.ts`
- Test: `apps/api/src/lib/billing/overage.test.ts`
- Modify: `apps/api/src/lib/chat/agent-turn.ts` (emit on overage)

**Interfaces:**
- Consumes: `getStripe()`; the entitlement result's `overage` (Task 1).
- Produces: `emitOverageEvent(customerId: string | null | undefined, conversationId: string): Promise<void>` — reports one overage conversation to Stripe; no-op when unconfigured; never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/billing/overage.test.ts`:

```ts
import { describe, expect, test, afterEach } from 'bun:test'
import { emitOverageEvent } from './overage'

const savedKey = process.env.STRIPE_SECRET_KEY
const savedPrice = process.env.STRIPE_PRICE_OVERAGE
afterEach(() => {
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey
  if (savedPrice === undefined) delete process.env.STRIPE_PRICE_OVERAGE; else process.env.STRIPE_PRICE_OVERAGE = savedPrice
})

describe('emitOverageEvent', () => {
  test('no-ops (does not throw) when Stripe is unconfigured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_OVERAGE
    await expect(emitOverageEvent('cus_123', 'conv_1')).resolves.toBeUndefined()
  })
  test('no-ops when the customer id is missing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_PRICE_OVERAGE = 'price_x'
    await expect(emitOverageEvent(null, 'conv_1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/billing/overage.test.ts`
Expected: FAIL — cannot find module `./overage`.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/lib/billing/overage.ts`:

```ts
import { getStripe } from './stripe'

/**
 * Report one overage conversation to Stripe metered billing. No-op when billing/overage
 * isn't configured (self-host) or the customer id is missing. Never throws.
 */
export async function emitOverageEvent(customerId: string | null | undefined, conversationId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_OVERAGE || !customerId) return
  try {
    await getStripe().billing.meterEvents.create({
      event_name: process.env.STRIPE_OVERAGE_METER_EVENT ?? 'ayooda_overage_conversations',
      identifier: conversationId,
      payload: { stripe_customer_id: customerId, value: '1' },
    })
  } catch (err) {
    console.warn('[overage] meter event failed:', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/billing/overage.test.ts`
Expected: PASS.

- [ ] **Step 5: Emit on overage in `prepareTurn`**

In `apps/api/src/lib/chat/agent-turn.ts`, add the import:

```ts
import { emitOverageEvent } from '../billing/overage'
```

Inside the `if (!convSnap.exists) { … }` billing/new-conversation block, immediately **after** `await workspaceRef.update(update)` (the usage increment), add:

```ts
    if (ent.overage && (sub?.status === 'active' || sub?.status === 'past_due')) {
      void emitOverageEvent(sub?.stripeCustomerId, conversationId)
    }
```

(`ent`, `sub`, and `conversationId` are all in scope in that block. `void` keeps it fire-and-forget.)

- [ ] **Step 6: Typecheck + build + full api tests**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun && bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/billing/overage.ts apps/api/src/lib/billing/overage.test.ts apps/api/src/lib/chat/agent-turn.ts
git commit -m "feat(billing): emit a Stripe meter event per overage conversation"
```

---

### Task 5: Backfill overage item onto existing subscriptions

**Files:**
- Create: `apps/api/scripts/backfill-overage-item.ts`

**Interfaces:**
- Consumes: `getStripe()`; `process.env.STRIPE_PRICE_OVERAGE`.
- Produces: an idempotent script that adds the metered overage price to subscriptions missing it.

- [ ] **Step 1: Write the script**

Create `apps/api/scripts/backfill-overage-item.ts`:

```ts
/**
 * One-time: add the metered overage price to existing subscriptions that lack it.
 * Run: cd apps/api && set -a && source .env && set +a && bun run scripts/backfill-overage-item.ts
 * Idempotent — safe to re-run.
 */
import { getStripe } from '../src/lib/billing/stripe'

const overagePrice = process.env.STRIPE_PRICE_OVERAGE
if (!overagePrice) {
  console.error('STRIPE_PRICE_OVERAGE is not set — run setup-stripe.ts first and export it.')
  process.exit(1)
}

const stripe = getStripe()
let updated = 0
for (const status of ['active', 'past_due', 'trialing'] as const) {
  for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
    const hasOverage = sub.items.data.some((i) => i.price.id === overagePrice)
    if (!hasOverage) {
      await stripe.subscriptionItems.create({ subscription: sub.id, price: overagePrice })
      updated++
      console.log(`[backfill] added overage item to ${sub.id} (${status})`)
    }
  }
}
console.log(`[backfill] done — ${updated} subscription(s) updated`)
process.exit(0)
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. (Runs against Stripe at deploy; not executed here.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/backfill-overage-item.ts
git commit -m "feat(billing): backfill script to add the overage item to existing subs"
```

---

### Task 6: `GET /billing` overage fields

**Files:**
- Modify: `apps/api/src/routes/billing.ts` (`GET /`)

**Interfaces:**
- Consumes: `checkEntitlement` result (`includedCap`, `ceiling`), `OVERAGE_RATE_USD`, `shouldResetPeriod`.
- Produces: `GET /billing` response adds `includedCap`, `ceiling`, `overageCount`, `estOverageUsd`.

- [ ] **Step 1: Compute a reset-aware used count + overage fields**

In `apps/api/src/routes/billing.ts`, add `OVERAGE_RATE_USD` and `shouldResetPeriod` to the imports (shared / `../lib/billing/entitlement`). In `GET /`, after computing `ent`, replace the `return c.json({...})` with:

```ts
  const periodStart = usage.periodStart?.toDate?.() ?? null
  const reset = shouldResetPeriod(periodStart, new Date(), sub)
  const used = reset ? 0 : (usage.periodConversationCount ?? 0)
  const overageCount = Math.max(0, used - ent.includedCap)
  const estOverageUsd = Math.round(overageCount * OVERAGE_RATE_USD * 100) / 100

  return c.json({
    subscription: sub ? {
      status: sub.status, tier: sub.tier,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
    } : null,
    usage: { periodConversationCount: used },
    entitled: ent.entitled, reason: ent.reason, tier: ent.tier,
    includedCap: ent.includedCap, ceiling: ent.ceiling, overageCount, estOverageUsd,
    plans: PLANS,
  })
```

(This drops the legacy `cap` field; the web page migrates to `includedCap` in Task 7.)

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/api && pnpm --filter api typecheck && bun build src/index.ts --outfile /dev/null --target bun`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/billing.ts
git commit -m "feat(billing): GET /billing returns includedCap + overage estimate"
```

---

### Task 7: Web Billing page — overage display

**Files:**
- Modify: `apps/web/src/app/dashboard/billing/page.tsx`

**Interfaces:**
- Consumes: the `GET /billing` fields `includedCap`, `overageCount`, `estOverageUsd`, `ceiling`.

- [ ] **Step 1: Read the page + update the usage type**

Open `apps/web/src/app/dashboard/billing/page.tsx`. Find the TypeScript interface/type for the `GET /billing` response (it currently reads `cap`/`usage.periodConversationCount`). Replace `cap: number` with:

```ts
  includedCap: number
  ceiling: number
  overageCount: number
  estOverageUsd: number
```

and update any reference to the old `cap` field to `includedCap`.

- [ ] **Step 2: Show included usage + overage**

Where the page renders usage (the "conversations used this period" area), render the included count and, when over, the overage estimate. Use the fetched `data` object:

```tsx
  <p style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
    {data.usage.periodConversationCount} / {data.includedCap} included conversations used this period
  </p>
  {data.overageCount > 0 && (
    <p style={{ fontSize: 13, color: 'var(--accent)', marginTop: 4 }}>
      {data.overageCount} over your plan — an estimated ${data.estOverageUsd.toFixed(2)} this period ($0.05 each)
    </p>
  )}
```

Place this in the existing usage/plan card, matching the surrounding style (reuse the nearby style objects). Keep the trial banner and plan cards unchanged.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/billing/page.tsx
git commit -m "feat(web): Billing page shows overage count + estimate"
```

---

## Live E2E (after all tasks — from the spec §10)

Stripe **test mode**:

1. `cd apps/api && set -a && source .env && set +a && bun run scripts/setup-stripe.ts` → note the printed `STRIPE_PRICE_OVERAGE` + `STRIPE_OVERAGE_METER_EVENT`; put them in `.env`.
2. Subscribe a test workspace (Lite) via Checkout → confirm the Stripe subscription has **two items** (flat + metered).
3. Drive conversations past the included cap (100) → they keep working; on the Stripe customer, a **meter event** appears and the upcoming invoice shows metered usage; the Billing page shows the overage count + `$` estimate.
4. Re-run a turn for an existing `conversationId` (or replay) → **no second meter event** (idempotent identifier).
5. Push to the ceiling (1,000) → new conversations `402` with `ceiling_reached`.
6. Create a subscription without the overage item (or pre-existing), run `backfill-overage-item.ts` → the overage item is added; re-run → 0 updated (idempotent).

Clean up test data.

## Out of scope

Changing the $0.05 rate or included amounts; annual billing; overage for trials; graduated/tiered metered pricing; per-message metering; credit-note/proration logic; a self-serve rate/ceiling editor.
