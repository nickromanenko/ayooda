# Ayooda Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-12-stripe-billing-design.md`: subscription tiers (Lite/Core/Max) with a 14-day no-card trial, a monthly conversation cap per tier, a hard gate that stops the widget answering when unentitled, and Stripe Checkout + Customer Portal synced to Firestore via a signed webhook.

**Architecture:** Pure entitlement/period logic in `@ayooda/shared` + `apps/api/src/lib/billing/`; a Stripe client + `/billing` routes (checkout, portal, status, webhook); the widget chat handler gains a pre-stream 402 gate on new conversations; a dashboard Billing page drives Checkout/Portal. Trial lives in Firestore; Stripe enters only on subscribe. Webhooks carry `workspaceId` in Stripe metadata so no lookup query is needed.

**Tech Stack:** Hono 4 on Bun, official `stripe` npm package, firebase-admin 12, Next.js 16, `bun test`.

## Global Constraints

- Billing model: subscription tiers + monthly conversation cap. **No metered overage** this round.
- Caps: Lite 100 / Core 500 / Max 1500; **trial cap 50**; **trial 14 days**. Prices Lite $25 / Core $55 / Max $195.
- Enforcement: **hard gate on NEW conversations** — pre-stream JSON **402** `{ error, reason }`; in-progress conversations are never gated mid-thread; the widget renders any non-SSE response as its generic bubble so visitors never see billing text.
- Trial lives in Firestore (`subscription.status: 'trialing'`, `trialEndsAt = createdAt + 14d`); Stripe only on subscribe.
- Stripe Checkout + Customer Portal (hosted). Webhook uses **raw body** + `stripe.webhooks.constructEvent` for signature verification, is **public** (no `requireAuth`). Webhooks resolve the workspace via `metadata.workspaceId` (set on the Stripe customer + subscription), and `client_reference_id` on the checkout session.
- Never return Stripe secrets or keys in any response.
- Env (document in `apps/api/.env.example`): `STRIPE_SECRET_KEY` (present), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_LITE`, `STRIPE_PRICE_CORE`, `STRIPE_PRICE_MAX`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`.
- `@ayooda/shared` builds to `dist/` — run `pnpm --filter @ayooda/shared build` after editing it. `apps/web` is Next.js 16 (client components here). Run `corepack enable` if `pnpm` is missing.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Shared billing types + plan catalog

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: `SubscriptionStatus`, `PlanTier`, `Subscription`, extended `WorkspaceUsage`, `PlanDef`, `PLANS`, `TRIAL_DAYS`, `TRIAL_CONVERSATION_CAP`, `planFor(tier)`. Tasks 2–7 import these.

- [ ] **Step 1: Write the failing test** — append to `packages/shared/src/index.test.ts`:

```ts
import { PLANS, planFor, TRIAL_DAYS, TRIAL_CONVERSATION_CAP } from './index'

describe('billing plans', () => {
  test('three tiers with the agreed caps and prices', () => {
    expect(PLANS.map((p) => p.tier)).toEqual(['lite', 'core', 'max'])
    expect(PLANS.map((p) => p.conversationCap)).toEqual([100, 500, 1500])
    expect(PLANS.map((p) => p.priceUsd)).toEqual([25, 55, 195])
  })
  test('planFor resolves a tier, undefined for null/unknown', () => {
    expect(planFor('core')?.conversationCap).toBe(500)
    expect(planFor(null)).toBeUndefined()
  })
  test('trial constants', () => {
    expect(TRIAL_DAYS).toBe(14)
    expect(TRIAL_CONVERSATION_CAP).toBe(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test`
Expected: FAIL — `PLANS` not exported.

- [ ] **Step 3: Implement in `packages/shared/src/index.ts`**

Extend `WorkspaceUsage` (find the existing interface) to:

```ts
export interface WorkspaceUsage {
  conversationCount: number
  messageCount: number
  tokenCount: number
  periodConversationCount: number
  periodStart: Date | null
}
```

Append a billing section near the other exports:

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

export function planFor(tier: PlanTier | null): PlanDef | undefined {
  return tier ? PLANS.find((p) => p.tier === tier) : undefined
}
```

Also add `subscription?: Subscription` to `WorkspaceDoc`.

- [ ] **Step 4: Run test + build**

Run: `cd packages/shared && bun test` → PASS. Then `pnpm --filter @ayooda/shared build && pnpm -r typecheck`.
Expected: PASS. If `WorkspaceUsage`'s new required fields break existing typed reads (e.g. `useWorkspace.ts` declares its own `usage` shape), those are separate local interfaces — leave them; only fix real `@ayooda/shared` consumers if the compiler flags them.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): billing types, plan catalog, trial constants"
```

---

### Task 2: Entitlement + period-reset logic (pure)

**Files:**
- Create: `apps/api/src/lib/billing/entitlement.ts`
- Create: `apps/api/src/lib/billing/entitlement.test.ts`

**Interfaces:**
- Consumes: `Subscription`, `PlanTier`, `planFor`, `TRIAL_CONVERSATION_CAP` from Task 1.
- Produces: `checkEntitlement(input): { entitled, reason, cap, tier }`; `shouldResetPeriod(periodStart, now, subscription): boolean`. Task 6 calls both.

- [ ] **Step 1: Write the failing test** — `apps/api/src/lib/billing/entitlement.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { checkEntitlement, shouldResetPeriod } from './entitlement'
import type { Subscription } from '@ayooda/shared'

const base = (over: Partial<Subscription>): Subscription => ({
  status: 'trialing', tier: null, trialEndsAt: null, currentPeriodEnd: null,
  stripeCustomerId: null, stripeSubscriptionId: null, ...over,
})
const created = new Date('2026-01-01T00:00:00Z')

describe('checkEntitlement', () => {
  test('active subscription under cap → entitled', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'core' }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date() })
    expect(r).toEqual({ entitled: true, reason: 'ok', cap: 500, tier: 'core' })
  })
  test('active subscription over cap → over_cap', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'lite' }), periodConversationCount: 100, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('over_cap')
  })
  test('past_due still entitled but flagged', () => {
    const r = checkEntitlement({ subscription: base({ status: 'past_due', tier: 'lite' }), periodConversationCount: 5, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.reason).toBe('past_due')
  })
  test('trial active under trial cap → entitled', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date('2026-01-10T00:00:00Z') })
    expect(r).toEqual({ entitled: true, reason: 'ok', cap: 50, tier: null })
  })
  test('trial active over trial cap → over_cap', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 50, workspaceCreatedAt: created, now: new Date('2026-01-10T00:00:00Z') })
    expect(r.reason).toBe('over_cap'); expect(r.entitled).toBe(false)
  })
  test('trial expired → trial_expired', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 0, workspaceCreatedAt: created, now: new Date('2026-02-01T00:00:00Z') })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('trial_expired')
  })
  test('canceled → no_subscription', () => {
    const r = checkEntitlement({ subscription: base({ status: 'canceled', tier: 'core' }), periodConversationCount: 0, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('no_subscription')
  })
  test('missing subscription on an old workspace → trial_expired', () => {
    const r = checkEntitlement({ subscription: undefined, periodConversationCount: 0, workspaceCreatedAt: created, now: new Date('2026-03-01T00:00:00Z') })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('trial_expired')
  })
})

describe('shouldResetPeriod', () => {
  test('same calendar month → false (trial)', () => {
    expect(shouldResetPeriod(new Date('2026-01-03'), new Date('2026-01-28'), base({}))).toBe(false)
  })
  test('crossed into a new month → true (trial)', () => {
    expect(shouldResetPeriod(new Date('2026-01-28'), new Date('2026-02-02'), base({}))).toBe(true)
  })
  test('null periodStart → true', () => {
    expect(shouldResetPeriod(null, new Date(), base({}))).toBe(true)
  })
  test('subscriber: now past currentPeriodEnd → true', () => {
    expect(shouldResetPeriod(new Date('2026-01-01'), new Date('2026-02-10'), base({ status: 'active', currentPeriodEnd: new Date('2026-02-01') }))).toBe(true)
  })
  test('subscriber: now before currentPeriodEnd → false', () => {
    expect(shouldResetPeriod(new Date('2026-01-01'), new Date('2026-01-20'), base({ status: 'active', currentPeriodEnd: new Date('2026-02-01') }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && bun test src/lib/billing/entitlement.test.ts`
Expected: FAIL — cannot resolve `./entitlement`.

- [ ] **Step 3: Implement `apps/api/src/lib/billing/entitlement.ts`**

```ts
import { planFor, TRIAL_CONVERSATION_CAP, type Subscription, type PlanTier } from '@ayooda/shared'

export type GateReason = 'ok' | 'trial_expired' | 'no_subscription' | 'over_cap' | 'past_due'

export interface EntitlementInput {
  subscription: Subscription | undefined
  periodConversationCount: number
  workspaceCreatedAt: Date
  now: Date
}

export interface EntitlementResult {
  entitled: boolean
  reason: GateReason
  cap: number
  tier: PlanTier | null
}

export function checkEntitlement(input: EntitlementInput): EntitlementResult {
  const { subscription: sub, periodConversationCount: used, now } = input
  const status = sub?.status ?? 'expired' // missing subscription = old workspace, no active plan

  // Active or past_due (grace) subscription
  if (status === 'active' || status === 'past_due') {
    const plan = planFor(sub!.tier)
    const cap = plan?.conversationCap ?? 0
    if (used >= cap) return { entitled: false, reason: 'over_cap', cap, tier: sub!.tier }
    return { entitled: true, reason: status === 'past_due' ? 'past_due' : 'ok', cap, tier: sub!.tier }
  }

  // Trial
  if (status === 'trialing') {
    const ends = sub?.trialEndsAt ?? null
    if (ends && now >= ends) return { entitled: false, reason: 'trial_expired', cap: TRIAL_CONVERSATION_CAP, tier: null }
    const cap = TRIAL_CONVERSATION_CAP
    if (used >= cap) return { entitled: false, reason: 'over_cap', cap, tier: null }
    return { entitled: true, reason: 'ok', cap, tier: null }
  }

  // canceled / expired / missing
  if (status === 'canceled') return { entitled: false, reason: 'no_subscription', cap: 0, tier: sub?.tier ?? null }
  return { entitled: false, reason: 'trial_expired', cap: 0, tier: null }
}

export function shouldResetPeriod(
  periodStart: Date | null,
  now: Date,
  subscription: Subscription | undefined,
): boolean {
  if (!periodStart) return true
  // Subscribers: reset when the Stripe billing period rolls over
  if ((subscription?.status === 'active' || subscription?.status === 'past_due') && subscription.currentPeriodEnd) {
    return now >= subscription.currentPeriodEnd
  }
  // Trial / no subscription: reset on calendar-month change
  return (
    now.getUTCFullYear() !== periodStart.getUTCFullYear() ||
    now.getUTCMonth() !== periodStart.getUTCMonth()
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && bun test src/lib/billing/entitlement.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/billing/entitlement.ts apps/api/src/lib/billing/entitlement.test.ts
git commit -m "feat(api): billing entitlement + period-reset logic"
```

---

### Task 3: Seed trial on new workspaces

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Create: `apps/api/scripts/backfill-trials.ts`

**Interfaces:**
- Consumes: `TRIAL_DAYS` from Task 1.
- Produces: new workspaces seeded with `subscription.trialing` + `usage.period*`. Task 6 reads these.

_No unit test — Firestore seed; verified in Task 8 E2E (a fresh signup gets a trial)._

- [ ] **Step 1: Extend the workspace seed**

In `apps/api/src/routes/auth.ts`, add the import: `import { TRIAL_DAYS } from '@ayooda/shared'`. In the `batch.set(workspaceRef, {...})` payload, extend `usage` and add `subscription` (compute `trialEnds` from `now`):

```ts
    usage: {
      conversationCount: 0,
      messageCount: 0,
      tokenCount: 0,
      periodConversationCount: 0,
      periodStart: now,
    },
    subscription: {
      status: 'trialing',
      tier: null,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
```

- [ ] **Step 2: Create the backfill script `apps/api/scripts/backfill-trials.ts`**

```ts
/**
 * One-time: grant existing (pre-billing) workspaces a fresh 14-day trial so the
 * hard gate doesn't cut them off on deploy. Run manually:
 *   cd apps/api && set -a && source .env && set +a && bun run scripts/backfill-trials.ts
 */
import { adminDb } from '../src/lib/firebase-admin'
import { TRIAL_DAYS } from '@ayooda/shared'

const snap = await adminDb.collection('workspaces').get()
const now = new Date()
let updated = 0
for (const doc of snap.docs) {
  if (doc.data().subscription) continue // already has billing state
  await doc.ref.update({
    subscription: {
      status: 'trialing',
      tier: null,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
    'usage.periodConversationCount': 0,
    'usage.periodStart': now,
  })
  updated++
}
console.log(`Backfilled ${updated} workspace(s).`)
process.exit(0)
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/routes/auth.ts apps/api/scripts/backfill-trials.ts
git commit -m "feat(api): seed 14-day trial on new workspaces + backfill script"
```

---

### Task 4: Stripe client, env, and setup script

**Files:**
- Create: `apps/api/src/lib/billing/stripe.ts`
- Create: `apps/api/scripts/setup-stripe.ts`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/package.json` (add `stripe`)

**Interfaces:**
- Produces: `getStripe(): Stripe`; `PRICE_BY_TIER: Record<PlanTier, string>` (from env). Task 5 uses both.

- [ ] **Step 1: Install the Stripe SDK**

Run: `pnpm --filter api add stripe`
(The official SDK runs on Bun; it uses Node `crypto` for webhook verification, which Bun provides.)

- [ ] **Step 2: Create `apps/api/src/lib/billing/stripe.ts`**

```ts
import Stripe from 'stripe'
import type { PlanTier } from '@ayooda/shared'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(key)
  }
  return _stripe
}

/** Env-provided Stripe Price IDs per tier (created by scripts/setup-stripe.ts). */
export const PRICE_BY_TIER: Record<PlanTier, string | undefined> = {
  lite: process.env.STRIPE_PRICE_LITE,
  core: process.env.STRIPE_PRICE_CORE,
  max: process.env.STRIPE_PRICE_MAX,
}

/** Reverse lookup: Stripe Price ID → tier (for webhook subscription sync). */
export function tierForPrice(priceId: string): PlanTier | null {
  for (const tier of ['lite', 'core', 'max'] as PlanTier[]) {
    if (PRICE_BY_TIER[tier] === priceId) return tier
  }
  return null
}
```

- [ ] **Step 3: Create the setup script `apps/api/scripts/setup-stripe.ts`**

```ts
/**
 * One-time: create the three products + monthly prices in Stripe TEST mode.
 * Run: cd apps/api && set -a && source .env && set +a && bun run scripts/setup-stripe.ts
 * Then paste the printed STRIPE_PRICE_* values into apps/api/.env.
 * Idempotent: skips a product if one with the same name already exists.
 */
import { getStripe } from '../src/lib/billing/stripe'
import { PLANS } from '@ayooda/shared'

const stripe = getStripe()
const existing = await stripe.products.list({ limit: 100 })

for (const plan of PLANS) {
  const name = `Ayooda ${plan.name}`
  let product = existing.data.find((p) => p.name === name)
  if (!product) product = await stripe.products.create({ name })
  // Find or create a monthly recurring price at the plan's amount
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
  let price = prices.data.find((p) => p.unit_amount === plan.priceUsd * 100 && p.recurring?.interval === 'month')
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.priceUsd * 100,
      currency: 'usd',
      recurring: { interval: 'month' },
    })
  }
  console.log(`STRIPE_PRICE_${plan.tier.toUpperCase()}=${price.id}`)
}
process.exit(0)
```

- [ ] **Step 4: Document env vars**

In `apps/api/.env.example`, add:
```
STRIPE_WEBHOOK_SECRET= # from `stripe listen` or the dashboard webhook endpoint
STRIPE_PRICE_LITE= # from scripts/setup-stripe.ts
STRIPE_PRICE_CORE=
STRIPE_PRICE_MAX=
BILLING_SUCCESS_URL= # e.g. http://localhost:3000/dashboard/billing?checkout=success
BILLING_CANCEL_URL=  # e.g. http://localhost:3000/dashboard/billing?checkout=cancel
```

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter api typecheck`
```bash
git add apps/api/src/lib/billing/stripe.ts apps/api/scripts/setup-stripe.ts apps/api/.env.example apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): Stripe client, price catalog, and setup script"
```

---

### Task 5: Billing routes (checkout, portal, status, webhook)

**Files:**
- Create: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/index.ts` (mount `/billing`)

**Interfaces:**
- Consumes: `getStripe`, `PRICE_BY_TIER`, `tierForPrice` (Task 4); `checkEntitlement`, `shouldResetPeriod` (Task 2); `PLANS`, `planFor` (Task 1); `requireAuth`, `adminDb`.
- Produces: `POST /billing/checkout`, `POST /billing/portal`, `GET /billing`, `POST /billing/webhook`. Task 7 calls the first three.

_No unit test — Stripe/Firestore I/O; verified in Task 8 with the Stripe test key + a constructed signed webhook event._

- [ ] **Step 1: Create `apps/api/src/routes/billing.ts`**

```ts
import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { getStripe, PRICE_BY_TIER, tierForPrice } from '../lib/billing/stripe'
import { checkEntitlement } from '../lib/billing/entitlement'
import { PLANS, planFor, type PlanTier, type Subscription } from '@ayooda/shared'

const billing = new Hono<{ Variables: AuthVariables }>()

// ---- Webhook (PUBLIC, raw body, no auth) — register BEFORE requireAuth ----
billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return c.json({ error: 'Missing signature' }, 400)

  const raw = await c.req.text()
  let event
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret)
  } catch (err) {
    console.warn('[billing/webhook] signature verification failed:', err)
    return c.json({ error: 'Invalid signature' }, 400)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as { client_reference_id?: string | null; customer?: string | null; subscription?: string | null }
      const workspaceId = s.client_reference_id ?? undefined
      if (workspaceId && s.subscription) {
        const sub = await getStripe().subscriptions.retrieve(s.subscription)
        await applySubscription(workspaceId, sub, s.customer ?? null)
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as { id: string; status: string; metadata?: Record<string, string>; customer?: string | null; items?: { data: Array<{ price?: { id?: string } }> }; current_period_end?: number }
      const workspaceId = sub.metadata?.workspaceId
      if (workspaceId) await applySubscription(workspaceId, sub, sub.customer ?? null)
    }
    // other event types: acknowledge and ignore
  } catch (err) {
    console.error('[billing/webhook] handler error:', err)
    // Still 200 to avoid Stripe retry storms on our internal errors; logged for follow-up
  }
  return c.json({ received: true })
})

/** Map a Stripe subscription object onto the workspace's `subscription` field. */
async function applySubscription(
  workspaceId: string,
  sub: { status: string; items?: { data: Array<{ price?: { id?: string } }> }; current_period_end?: number; id?: string },
  customerId: string | null,
): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id
  const tier: PlanTier | null = priceId ? tierForPrice(priceId) : null
  const status: Subscription['status'] =
    sub.status === 'active' ? 'active'
    : sub.status === 'past_due' ? 'past_due'
    : sub.status === 'trialing' ? 'active' // Stripe-side trial → treat as active entitlement
    : sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired' ? 'canceled'
    : 'active'
  await adminDb.doc(`workspaces/${workspaceId}`).update({
    'subscription.status': status,
    'subscription.tier': tier,
    'subscription.currentPeriodEnd': sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    'subscription.stripeCustomerId': customerId,
    'subscription.stripeSubscriptionId': sub.id ?? null,
  })
}

// ---- Authenticated endpoints ----
billing.use('/checkout', requireAuth)
billing.use('/portal', requireAuth)
billing.use('/', requireAuth)

billing.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const data = snap.data()!
  const sub: Subscription | undefined = data.subscription
  const usage = data.usage ?? {}
  const ent = checkEntitlement({
    subscription: sub,
    periodConversationCount: usage.periodConversationCount ?? 0,
    workspaceCreatedAt: data.createdAt?.toDate?.() ?? new Date(0),
    now: new Date(),
  })
  return c.json({
    subscription: sub ? {
      status: sub.status, tier: sub.tier,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      // never return stripeCustomerId/stripeSubscriptionId
    } : null,
    usage: { periodConversationCount: usage.periodConversationCount ?? 0 },
    entitled: ent.entitled, reason: ent.reason, cap: ent.cap, tier: ent.tier,
    plans: PLANS,
  })
})

billing.post('/checkout', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ tier?: PlanTier }>()
  if (!body.tier || !planFor(body.tier)) return c.json({ error: 'Invalid tier' }, 400)
  const price = PRICE_BY_TIER[body.tier]
  if (!price) return c.json({ error: 'Plan not configured' }, 500)

  const ref = adminDb.doc(`workspaces/${workspaceId}`)
  const data = (await ref.get()).data()!
  let customerId: string | null = data.subscription?.stripeCustomerId ?? null
  if (!customerId) {
    const customer = await getStripe().customers.create({ metadata: { workspaceId } })
    customerId = customer.id
    await ref.update({ 'subscription.stripeCustomerId': customerId })
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: workspaceId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspaceId } },
    success_url: process.env.BILLING_SUCCESS_URL!,
    cancel_url: process.env.BILLING_CANCEL_URL!,
  })
  return c.json({ url: session.url })
})

billing.post('/portal', async (c) => {
  const workspaceId = c.get('workspaceId')
  const data = (await adminDb.doc(`workspaces/${workspaceId}`).get()).data()!
  const customerId = data.subscription?.stripeCustomerId
  if (!customerId) return c.json({ error: 'No billing account yet' }, 400)
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: process.env.BILLING_SUCCESS_URL!,
  })
  return c.json({ url: session.url })
})

export default billing
```

Note on route order: the webhook is registered before the `billing.use('/', requireAuth)` middleware so it stays public. Hono applies `use` middleware to matching paths registered **after** the `use` call; since `/webhook`'s handler is registered above the `use('/')`, and `use('/')` matches the root path prefix — to be safe, scope the auth middleware to the specific authenticated subpaths (`/checkout`, `/portal`) and gate `GET /` inside its handler by placing `billing.use('/', requireAuth)` **after** the webhook route but confirm the webhook path isn't caught. If `use('/')` catches `/webhook`, change it to `billing.get('/', requireAuth, handler)` inline form instead of a broad `use`. The implementer must verify the webhook remains reachable without auth (Task 8 sends an unauthenticated signed event).

- [ ] **Step 2: Mount the route**

In `apps/api/src/index.ts`, add `import billingRoutes from './routes/billing'` with the other imports and `app.route('/billing', billingRoutes)` with the other mounts (after `/workspace`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. If Stripe's TS types complain about `current_period_end`/`items` on the loosely-typed event objects, keep the local structural types as written (they intentionally narrow only the fields used) or cast via `as Stripe.Subscription` — do not `any`-cast the whole handler.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/index.ts
git commit -m "feat(api): billing routes — checkout, portal, status, webhook"
```

---

### Task 6: Chat gate on new conversations

**Files:**
- Modify: `apps/api/src/routes/widget.ts`

**Interfaces:**
- Consumes: `checkEntitlement`, `shouldResetPeriod` (Task 2).
- Produces: `POST /widget/chat` returns pre-stream `402 { error, reason }` when a new conversation would exceed entitlement.

_No unit test — integration handler; verified in Task 8 E2E._

- [ ] **Step 1: Add imports**

In `apps/api/src/routes/widget.ts`:

```ts
import { checkEntitlement, shouldResetPeriod } from '../lib/billing/entitlement'
```

- [ ] **Step 2: Gate new conversations**

In the `POST /chat` handler, the conversation get-or-create block currently reads (around the existing lines):

```ts
  if (!convSnap.exists) {
    await convRef.set({ ... })
    await workspaceRef.update({ 'usage.conversationCount': FieldValue.increment(1) })
  }
```

Replace that `if (!convSnap.exists) { ... }` block with a gated version that runs entitlement BEFORE creating the conversation, and increments the period counter (with a reset when the period rolled):

```ts
  if (!convSnap.exists) {
    // Billing gate — only NEW conversations are gated; in-progress chats continue.
    const sub = workspaceData.subscription
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
    if (!ent.entitled) {
      return c.json(
        { error: 'This workspace has reached its plan limit or its trial has ended.', reason: ent.reason },
        402,
      )
    }

    await convRef.set({
      channelId,
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: message.trim(),
    })

    // Increment lifetime + period counters; reset the period window if it rolled.
    const update: Record<string, unknown> = {
      'usage.conversationCount': FieldValue.increment(1),
    }
    if (reset) {
      update['usage.periodConversationCount'] = 1
      update['usage.periodStart'] = FieldValue.serverTimestamp()
    } else {
      update['usage.periodConversationCount'] = FieldValue.increment(1)
    }
    await workspaceRef.update(update)
  }
```

This preserves the existing conversation-create + lifetime-counter behavior and adds the gate + period counter. Everything after (user message save, RAG, OpenRouter streaming) is unchanged.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/widget.ts
git commit -m "feat(api): hard-gate new widget conversations on billing entitlement"
```

---

### Task 7: Web — Billing page + nav + overview banner

**Files:**
- Create: `apps/web/src/app/dashboard/billing/page.tsx`
- Modify: `apps/web/src/components/dashboard/Sidebar.tsx` (add a Billing nav link)
- Modify: `apps/web/src/app/dashboard/page.tsx` (trial/entitlement banner)

**Interfaces:**
- Consumes: `GET /billing`, `POST /billing/checkout`, `POST /billing/portal` (Task 5); `apiRequest`.
- Produces: the user-visible Billing page.

_No unit test — UI; verified in Task 8._

- [ ] **Step 1: Create `apps/web/src/app/dashboard/billing/page.tsx`**

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiRequest } from '@/lib/api'

interface PlanDef { tier: string; name: string; priceUsd: number; conversationCap: number }
interface BillingData {
  subscription: { status: string; tier: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null } | null
  usage: { periodConversationCount: number }
  entitled: boolean; reason: string; cap: number; tier: string | null
  plans: PlanDef[]
}

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/billing')
      if (res.ok) setData(await res.json() as BillingData)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function upgrade(tier: string) {
    setBusy(tier)
    try {
      const res = await apiRequest('/billing/checkout', { method: 'POST', body: JSON.stringify({ tier }) })
      const { url } = await res.json() as { url?: string }
      if (url) window.location.href = url
    } finally { setBusy('') }
  }
  async function manage() {
    setBusy('manage')
    try {
      const res = await apiRequest('/billing/portal', { method: 'POST' })
      const { url } = await res.json() as { url?: string }
      if (url) window.location.href = url
    } finally { setBusy('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>
  if (!data) return <div style={{ padding: 24, color: '#f87171' }}>Failed to load billing.</div>

  const sub = data.subscription
  const pct = data.cap > 0 ? Math.min(100, Math.round((data.usage.periodConversationCount / data.cap) * 100)) : 0
  const trialLeft = sub?.status === 'trialing' && sub.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Billing</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Your plan and usage.</p>
      </div>

      {/* Current status */}
      <div style={card}>
        <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }}>Current plan</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>
            {sub?.tier ? data.plans.find((p) => p.tier === sub.tier)?.name : trialLeft !== null ? 'Free trial' : 'No plan'}
          </span>
          {trialLeft !== null && <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{trialLeft} day{trialLeft === 1 ? '' : 's'} left</span>}
          {sub?.status === 'past_due' && <span style={{ fontSize: 13, color: '#f59e0b' }}>Payment past due</span>}
          {!data.entitled && <span style={{ fontSize: 13, color: '#f87171' }}>Service paused</span>}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
            <span>Conversations this period</span><span>{data.usage.periodConversationCount} / {data.cap}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#f87171' : 'var(--accent)' }} />
          </div>
        </div>
        {sub?.tier && (
          <button type="button" onClick={() => void manage()} disabled={busy === 'manage'} className="btn btn-ghost" style={{ marginTop: 16, borderRadius: 'var(--r-sm)', padding: '8px 14px' }}>
            {busy === 'manage' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {/* Plans */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {data.plans.map((p) => {
          const current = sub?.tier === p.tier
          return (
            <div key={p.tier} style={{ ...card, marginBottom: 0, borderColor: current ? 'var(--accent)' : 'var(--line)' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</p>
              <p style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)', margin: '6px 0' }}>${p.priceUsd}<span style={{ fontSize: 13, color: 'var(--ink-mute)', fontWeight: 400 }}>/mo</span></p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{p.conversationCap.toLocaleString()} conversations / month</p>
              <button type="button" onClick={() => void upgrade(p.tier)} disabled={busy === p.tier || current} className="btn btn-primary" style={{ marginTop: 14, width: '100%', justifyContent: 'center', borderRadius: 'var(--r-sm)', opacity: current ? 0.5 : 1 }}>
                {current ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Check size={14} /> Current</span> : busy === p.tier ? 'Opening…' : 'Choose'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the Billing nav link**

In `apps/web/src/components/dashboard/Sidebar.tsx` (read it first to match its item shape/icon idiom), add a nav entry for Billing (`/dashboard/billing`) using a `CreditCard` lucide icon, placed near Settings.

- [ ] **Step 3: Overview banner**

In `apps/web/src/app/dashboard/page.tsx` (a server component), after computing the overview data, add a client fetch or a small server-side `GET /billing` is not trivial from a server component without the bearer token — instead add a lightweight client banner component `apps/web/src/components/dashboard/BillingBanner.tsx` (`'use client'`) that fetches `/billing` and, when `!entitled` or a trial has ≤3 days left, renders a dismissible-free banner linking to `/dashboard/billing` ("Your trial ends in N days — choose a plan" / "Service paused — upgrade to continue"). Render `<BillingBanner />` at the top of the overview page's returned JSX. Keep it visually consistent with the existing cards.

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiRequest } from '@/lib/api'

export function BillingBanner() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiRequest('/billing')
        if (!res.ok) return
        const d = await res.json() as { entitled: boolean; subscription: { status: string; trialEndsAt: string | null } | null }
        if (!d.entitled) { setMsg('Service is paused — choose a plan to continue.'); return }
        const t = d.subscription
        if (t?.status === 'trialing' && t.trialEndsAt) {
          const days = Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86400000)
          if (days <= 3) setMsg(`Your free trial ends in ${days} day${days === 1 ? '' : 's'}. Choose a plan to keep your agent live.`)
        }
      } catch { /* ignore */ }
    })()
  }, [])
  if (!msg) return null
  return (
    <Link href="/dashboard/billing" style={{ display: 'block', padding: '12px 16px', borderRadius: 'var(--r-md)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--ink)', fontSize: 13, marginBottom: 20, textDecoration: 'none' }}>
      {msg} <span style={{ color: 'var(--accent)' }}>Go to billing →</span>
    </Link>
  )
}
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: typecheck + build PASS; lint shows only the pre-existing failures (none in the new/edited files).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): billing page, nav link, and trial/entitlement banner"
```

---

### Task 8: Verification + docs

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm -r typecheck && pnpm -r --if-present test && pnpm --filter web build`
Expected: all pass (shared plan tests + entitlement's 13 tests included).

- [ ] **Step 2: Stripe setup + live E2E (Stripe TEST mode; `apps/api/.env` has `STRIPE_SECRET_KEY`)**

Use superpowers:verification-before-completion.
1. `cd apps/api && set -a && source .env && set +a && bun run scripts/setup-stripe.ts` → paste the printed `STRIPE_PRICE_*` into `apps/api/.env`. Set `BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL` to `http://localhost:3000/dashboard/billing`.
2. Start the API. With a minted ID token: `POST /billing/checkout {tier:'core'}` → returns a `https://checkout.stripe.com/...` URL (valid session). `GET /billing` → shows trialing + cap 50 + plans.
3. **Webhook without a browser:** obtain `STRIPE_WEBHOOK_SECRET` — either run `stripe listen --forward-to localhost:3001/billing/webhook` (prints a `whsec_...`), OR construct a signed event in a scratch script using `getStripe().webhooks.generateTestHeaderString({ payload, secret })` with a `checkout.session.completed` payload carrying `client_reference_id=<workspaceId>` and a real test `subscription` id — POST it to `/billing/webhook` and confirm 200 and the workspace flips to `active`/`core` with `currentPeriodEnd`. Confirm an **unauthenticated** POST to the webhook is accepted (no `requireAuth`), and a bad signature returns 400.
4. **Gate:** set a workspace's `subscription.trialEndsAt` to the past (scratch script) → `POST /widget/chat` with a new conversationId returns **402** (JSON, pre-stream); restore to entitled → chat streams again. Set `periodConversationCount` to the cap → new conversation 402s; an existing conversation still works.
5. **Backfill:** run `scripts/backfill-trials.ts` against the dev project → existing workspaces gain a fresh trial (spot-check one).
Record verified vs. deferred. **Deferred (manual, documented):** completing Checkout with a `4242…` test card in the browser + the Customer Portal UI.
Clean up any test state you changed (restore the test workspace's subscription to a sensible trialing/active state).

- [ ] **Step 3: Update `docs/architecture.md`**

Add a Billing section: subscription tiers + caps + trial model (Firestore-side trial), the `/billing` endpoints (checkout/portal/status/webhook), the hard gate (pre-stream 402 on new conversations), the `subscription` + `usage.period*` fields on the workspace doc, and the new env vars (`STRIPE_*`, `BILLING_*`). Note the webhook is public + signature-verified.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: architecture updates for Stripe billing"
```
