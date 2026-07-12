# Ayooda Sub-project C — Stripe Billing & Monetization — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Subscription billing (three tiers) with a 14-day no-card trial, a monthly conversation cap per tier, and a hard gate that stops the widget from answering when a workspace is out of trial/quota. Stripe Checkout + Customer Portal, synced to Firestore via webhook.

## Background

Ayooda has full product functionality but no monetization. The landing page already commits to three plans — **Lite $25 / Core $55 / Max $195** per month — a **14-day free trial (no card required)**, and included monthly conversations. This sub-project makes those real: it charges customers, tracks conversation usage against a per-tier cap, and blocks service when a workspace is unentitled.

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Billing model | Subscription tiers with a monthly conversation cap. Metered pay-as-you-go overage is **deferred** to a later iteration. |
| Enforcement | **Hard gate** — an unentitled or over-cap workspace's widget stops answering (visitor sees a generic "unavailable" message; operator sees the real reason). Gate is on **new** conversations. |
| Stripe surface | **Checkout + Customer Portal** (hosted); a signed webhook syncs status to Firestore. No card data touches our servers. |
| Trial | Lives in **our** system (Firestore), not Stripe. At workspace creation: `trialing`, `trialEndsAt = createdAt + 14 days`. Stripe enters only on subscribe. |
| Caps | Lite 100 / Core 500 / Max 1500 conversations per month; trial cap **50**. |
| Dependency | Official `stripe` npm package (for `webhooks.constructEvent` signature verification and typed API). |

---

## 1. Data model (Firestore + shared types)

Add a `subscription` object to the workspace doc (`packages/shared` `WorkspaceDoc`):

```ts
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PlanTier = 'lite' | 'core' | 'max'

export interface Subscription {
  status: SubscriptionStatus
  tier: PlanTier | null           // null while trialing/expired with no plan
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null   // Stripe subscription period end (subscribers)
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}
```

Extend `WorkspaceUsage` with the per-period counter:

```ts
export interface WorkspaceUsage {
  conversationCount: number       // lifetime (existing)
  messageCount: number            // existing
  tokenCount: number              // existing
  periodConversationCount: number // resets each billing period
  periodStart: Date | null        // start of the current usage period
}
```

Plan catalog (shared, single source of truth for caps/labels; **price IDs are env-provided, not hardcoded**):

```ts
export interface PlanDef { tier: PlanTier; name: string; priceUsd: number; conversationCap: number }
export const PLANS: readonly PlanDef[] = [
  { tier: 'lite', name: 'Lite', priceUsd: 25, conversationCap: 100 },
  { tier: 'core', name: 'Core', priceUsd: 55, conversationCap: 500 },
  { tier: 'max',  name: 'Max',  priceUsd: 195, conversationCap: 1500 },
]
export const TRIAL_DAYS = 14
export const TRIAL_CONVERSATION_CAP = 50
export function planFor(tier: PlanTier | null): PlanDef | undefined
```

New-workspace seed (`apps/api/src/routes/auth.ts`) adds:
```ts
subscription: { status: 'trialing', tier: null, trialEndsAt: <now + 14d>, currentPeriodEnd: null, stripeCustomerId: null, stripeSubscriptionId: null },
usage: { ...existing, periodConversationCount: 0, periodStart: <now> },
```
Existing workspaces (no `subscription`) are handled by the entitlement helper treating a missing `subscription` as an implicit already-expired trial that started at their `createdAt` — see §3 backward-compat.

## 2. Entitlement + cap logic (pure, unit-tested)

New module `apps/api/src/lib/billing/entitlement.ts`:

```ts
export interface EntitlementInput {
  subscription: Subscription | undefined
  periodConversationCount: number
  workspaceCreatedAt: Date
  now: Date
}
export type GateReason = 'ok' | 'trial_expired' | 'no_subscription' | 'over_cap' | 'past_due'
export function checkEntitlement(input: EntitlementInput): {
  entitled: boolean
  reason: GateReason
  cap: number            // effective cap for the current state
  tier: PlanTier | null
}
```

Rules (evaluated in order):
1. **Active subscription** (`status === 'active'`, or `past_due` within a grace window — treat `past_due` as still entitled but flagged): cap = that tier's cap. Over cap → `{entitled:false, reason:'over_cap'}`; else entitled.
2. **Trialing** and `now < trialEndsAt`: cap = `TRIAL_CONVERSATION_CAP`. Over cap → `over_cap`; else entitled.
3. **Trialing** and `now >= trialEndsAt` → `{entitled:false, reason:'trial_expired'}`.
4. **canceled/expired** or missing subscription past trial → `{entitled:false, reason:'no_subscription'}`.

This function has no I/O and is fully unit-testable across every branch (active-under-cap, active-over-cap, trial-active, trial-expired, canceled, missing-subscription-old-workspace).

Period reset is a separate pure helper `shouldResetPeriod(periodStart, now, subscription): boolean` — true when `now` has crossed into a new calendar month relative to `periodStart` (trial/no-sub) or crossed the previous `currentPeriodEnd` (subscribers). The chat handler resets `periodConversationCount` to 0 and `periodStart` to `now` when this returns true, before the cap check.

## 3. Chat gate integration

In `POST /widget/chat` ([apps/api/src/routes/widget.ts](../../../apps/api/src/routes/widget.ts)), at the **conversation get-or-create** point (already where `usage.conversationCount` is incremented):

- Load `subscription` + `usage` from the already-fetched `workspaceData`.
- If `shouldResetPeriod(...)`, reset `periodConversationCount`/`periodStart` (in the same update).
- Run `checkEntitlement(...)`. If **not entitled** AND this is a **new** conversation (`!convSnap.exists`), return a **pre-stream** response: JSON `402 { error: 'This workspace has reached its plan limit or its trial has ended.', reason }`. The widget already renders any non-SSE/failed response as its generic error bubble, so **visitors never see billing text**; operators see the real reason via the dashboard/logs. (Use 402 Payment Required — semantically correct and distinct from the 502/rate-limit paths.)
- Entitled → increment `usage.conversationCount` **and** `usage.periodConversationCount` on conversation create (existing increment extended), then proceed exactly as today.
- An already-existing conversation (`convSnap.exists`) is **not** gated mid-thread — the visitor can finish an in-progress chat; the gate applies to starting new ones. (This bounds new-conversation volume, which is what the cap measures.)

**Backward-compat:** `checkEntitlement` treats a `workspaceData.subscription === undefined` (pre-billing workspaces) as: trial that started at `workspaceCreatedAt`; since those are >14 days old, they resolve to `trial_expired`/`no_subscription` → gated. To avoid instantly cutting off any existing real workspaces on deploy, a one-time backfill script (documented, not auto-run) sets `subscription.trialing` with a fresh 14-day trial for existing workspaces. New signups get the trial via the seed.

## 4. Stripe integration

New module `apps/api/src/lib/billing/stripe.ts`: a lazily-constructed Stripe client from `STRIPE_SECRET_KEY`. Env: `STRIPE_SECRET_KEY` (present), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_LITE`/`STRIPE_PRICE_CORE`/`STRIPE_PRICE_MAX`, `BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL` (dashboard URLs).

New route `apps/api/src/routes/billing.ts` mounted at `/billing`:

- **`POST /billing/checkout`** (`requireAuth`) — body `{ tier }`. Validates tier ∈ PLANS. Creates/reuses a Stripe Customer for the workspace (store `stripeCustomerId`), creates a Checkout Session (`mode: 'subscription'`, the tier's price, `client_reference_id = workspaceId`, success/cancel URLs), returns `{ url }`. The web opens it.
- **`POST /billing/portal`** (`requireAuth`) — creates a Billing Portal session for the workspace's `stripeCustomerId`, returns `{ url }`. 400 if no customer yet.
- **`GET /billing`** (`requireAuth`) — returns `{ subscription, usage: { periodConversationCount }, cap, tier, entitled, reason, plans: PLANS }` for the dashboard (never returns Stripe secrets).
- **`POST /billing/webhook`** — **public**, raw-body, `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)` for signature verification. Handles: `checkout.session.completed` (link customer+subscription, set `status:'active'`, `tier` from the price, `currentPeriodEnd`), `customer.subscription.updated` (sync status/tier/period — active/past_due/canceled), `customer.subscription.deleted` (`status:'canceled'`). Resolves the workspace by `client_reference_id`/`stripeCustomerId`. Idempotent (re-processing the same event is safe — it's a state sync, not an increment). Returns 200 quickly; unknown event types are acknowledged and ignored.

The webhook must read the **raw request body** (Hono: `c.req.raw` / `await c.req.text()`) — do not let JSON middleware consume it, or signature verification fails. Mount billing so `/billing/webhook` is exempt from any body parsing, and it does **not** use `requireAuth`.

**Setup script** `apps/api/scripts/setup-stripe.ts` (run once manually with the test key): creates the three Products + monthly recurring Prices in Stripe test mode and prints `STRIPE_PRICE_*` values to paste into `.env`. Idempotent by product lookup (skip if a product with the same name exists).

## 5. Web — Billing page

New `apps/web/src/app/dashboard/billing/page.tsx` (client component, dashboard-nav entry added to the Sidebar):

- Fetches `GET /billing`. Shows: current plan (or "Trial" with a countdown to `trialEndsAt`), a usage bar `periodConversationCount / cap`, and status (active/past_due/canceled/trial-expired).
- Three plan cards (from the returned `plans`) each with an **Upgrade/Choose** button → `POST /billing/checkout` → `window.location = url`.
- If a subscription exists: a **Manage billing** button → `POST /billing/portal` → redirect.
- After returning from Checkout (success URL), the page re-fetches and reflects the new plan (webhook has by then synced status; a brief "activating…" state if `entitled` is not yet true is acceptable).

A gentle banner appears on the dashboard overview when `entitled` is false or the trial is within 3 days of ending, linking to Billing. (Reuse the existing overview server-side data path; add a small client fetch or thread `GET /billing` into the overview.)

## 6. Error handling

- Stripe API failures on checkout/portal → JSON 502 with a generic message; logged.
- Webhook signature failure → 400, do not process.
- Webhook for an unknown workspace → 200 (acknowledge; nothing to sync) with a warning log — avoids Stripe retry storms.
- Missing Stripe env (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/price IDs) → the billing module throws on first use with a clear message; documented in `.env.example`.
- The chat gate's 402 is pre-stream JSON; never a broken SSE stream.

## 7. Testing & verification

- **Unit tests** (`bun test`): `checkEntitlement` across all branches (active-under/over-cap, trial-active/expired, canceled, missing-subscription); `shouldResetPeriod` (same month, month rollover, subscriber period boundary); `planFor`/`PLANS` integrity.
- **Live E2E (Stripe test mode)**: run the setup script → real price IDs; `POST /billing/checkout` returns a valid Checkout URL; construct a signed test webhook event (`checkout.session.completed`) and POST it → workspace flips to `active`/tier and `currentPeriodEnd` set; `GET /billing` reflects it; drive the chat gate — set a workspace to `trial_expired` (or over cap) and confirm `POST /widget/chat` returns 402 pre-stream and an entitled workspace still streams.
- **Deferred (manual, documented)**: completing Checkout with a Stripe test card in the browser and the Customer Portal flow — needs an interactive browser + `4242…` test card. The webhook sync and gate are verified via constructed events without it.

## Out of scope

Metered pay-as-you-go overage; annual plans; coupons/discounts; proration UI; per-seat pricing (that's the Team sub-project); dunning emails; tax/VAT handling.
