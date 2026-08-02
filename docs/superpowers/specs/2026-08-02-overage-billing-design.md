# Ayooda Sub-project K — Metered Overage Billing — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning
**Scope:** Deliver the pricing model the landing page already promises: membership plans include a conversation pack, and usage **beyond** the included amount is billed at **$0.05/conversation** via Stripe metered billing — instead of hard-gating at the included cap. A high per-plan safety ceiling remains as an abuse backstop. Trials stay hard-capped.

## Background

The landing page ([apps/web/src/components/LandingPage.tsx](../../../apps/web/src/components/LandingPage.tsx)) advertises: Lite $25 / 100 convos, Core $55 / 500, Max $195 / 1500, with *"extra usage billed at $0.05 each."* But the implementation hard-gates: `checkEntitlement` ([apps/api/src/lib/billing/entitlement.ts](../../../apps/api/src/lib/billing/entitlement.ts)) returns `over_cap` once `periodConversationCount >= plan.conversationCap`, and `prepareTurn` ([apps/api/src/lib/chat/agent-turn.ts](../../../apps/api/src/lib/chat/agent-turn.ts)) returns a pre-stream `402` on new conversations. So the included pack is enforced as a hard ceiling and no overage is ever billed — the product under-delivers on its own pricing page.

Existing billing: Stripe Checkout + Customer Portal + a signed webhook (`constructEventAsync`), one **flat recurring price per tier** (`PRICE_BY_TIER`), subscription state synced to `workspaces/{id}.subscription` (`status`, `tier`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`), and `usage.periodConversationCount`/`periodStart` incremented per new conversation. Stripe API is pinned to `2026-06-24.dahlia` (item-level `current_period_end`).

## Decisions (agreed)

| Decision | Choice |
|---|---|
| Overage | Conversations beyond the included pack are **allowed** and billed **$0.05 each** via Stripe metered billing. |
| Metering | **Stripe Billing Meters API** — a meter + a shared $0.05 metered price added as a **second subscription item**. We emit a meter event of `1` **only** for over-cap conversations, so the meter equals overage count directly. |
| Safety ceiling | **`ceiling = includedCap × OVERAGE_CEILING_MULTIPLIER` (10)** per period (Lite 1,000 / Core 5,000 / Max 15,000). Over the ceiling → `402` with a new `ceiling_reached` reason. |
| Trials | **Unchanged** — hard cap at `TRIAL_CONVERSATION_CAP` (no card to bill). canceled/expired unchanged. |
| Idempotency | Meter events carry `identifier: conversationId` so retries never double-bill. |

---

## 1. Shared constants + types (`packages/shared`)

- `OVERAGE_RATE_USD = 0.05` and `OVERAGE_CEILING_MULTIPLIER = 10`.
- `PlanDef.conversationCap` is the **included** amount (unchanged); the guide/UI language shifts from "cap" to "included".

## 2. Entitlement (`apps/api/src/lib/billing/entitlement.ts`, pure + tested)

`GateReason` gains `'ceiling_reached'`. `EntitlementResult` gains:
- `includedCap: number` — the plan's included conversations (or `TRIAL_CONVERSATION_CAP` for trials).
- `ceiling: number` — the hard upper bound (`includedCap × OVERAGE_CEILING_MULTIPLIER` for active/past_due; `= includedCap` for trials, i.e. no overage).
- `overage: boolean` — whether the current (new) conversation is billable overage.

Logic:
- **active / past_due:** `plan = planFor(tier)`. If `!plan` → fail open (`entitled:true, overage:false`, unchanged safety). `includedCap = plan.conversationCap`, `ceiling = includedCap × OVERAGE_CEILING_MULTIPLIER`. If `used >= ceiling` → `{ entitled:false, reason:'ceiling_reached', includedCap, ceiling, tier }`. Else `{ entitled:true, reason: (past_due ? 'past_due' : 'ok'), overage: used >= includedCap, includedCap, ceiling, tier }`.
- **trialing:** unchanged cap logic; `includedCap = ceiling = TRIAL_CONVERSATION_CAP`, `overage:false`. Expired trial / over cap → gated as today.
- **canceled / expired / missing:** gated as today (`overage:false`).

`used` is `periodConversationCount` **before** the new conversation is counted (matches the current `used >= cap` semantics: the new conversation is overage iff `used >= includedCap`).

The existing `cap` field is replaced by `includedCap` (callers updated). `shouldResetPeriod` is unchanged (subscribers reset on `currentPeriodEnd`).

## 3. Stripe setup (`apps/api/scripts/setup-stripe.ts` + a meter)

Extend the script to also (idempotently):
- Create a **Billing Meter**: `stripe.billing.meters.create({ display_name: 'Ayooda overage conversations', event_name: 'ayooda_overage_conversations', default_aggregation: { formula: 'sum' }, customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' }, value_settings: { event_payload_key: 'value' } })` — skip if a meter with that `event_name` already exists.
- Create a shared **overage product** ("Ayooda Usage") + one **metered price**: `stripe.prices.create({ currency: 'usd', unit_amount: 5, product: <overageProductId>, recurring: { interval: 'month', usage_type: 'metered', meter: <meterId> } })` — reused across all tiers (rate is the same). Skip if an equivalent metered price already exists.
- Print `STRIPE_PRICE_OVERAGE=<priceId>` and `STRIPE_OVERAGE_METER_EVENT=ayooda_overage_conversations`.

## 4. Checkout — two subscription items (`apps/api/src/routes/billing.ts`)

`POST /billing/checkout` creates the subscription with **both** line items:
```
line_items: [
  { price: PRICE_BY_TIER[tier], quantity: 1 },
  { price: STRIPE_PRICE_OVERAGE },   // metered — no quantity
]
```
`STRIPE_PRICE_OVERAGE` read from env; if unset, fall back to the flat-only line item and log a warning (billing still works, overage simply isn't metered — non-fatal for a mis-provisioned deploy).

## 5. Existing subscriptions (`apps/api/scripts/backfill-overage-item.ts`, new)

A one-time idempotent script: list active/trialing subscriptions; for any whose items don't already include `STRIPE_PRICE_OVERAGE`, add it via `stripe.subscriptionItems.create({ subscription, price: STRIPE_PRICE_OVERAGE })`. Logs each change; safe to re-run. Documented as a deploy step.

## 6. Emit the meter event (`apps/api/src/lib/chat/agent-turn.ts`)

The billing gate in `prepareTurn` runs only for **new** conversations. After `checkEntitlement`:
- `!entitled` → `{ kind: 'gated', reason }` (now possibly `ceiling_reached`) — unchanged shape.
- Entitled path: create the conversation + increment usage as today. **Then**, if `ent.overage === true`, the subscription is active/past_due, and `subscription.stripeCustomerId` is set, emit a Stripe meter event (fire-and-forget, wrapped in try/catch — a failure logs and never blocks the turn):
  ```ts
  await getStripe().billing.meterEvents.create({
    event_name: process.env.STRIPE_OVERAGE_METER_EVENT ?? 'ayooda_overage_conversations',
    identifier: conversationId,                    // idempotent — no double-billing
    payload: { stripe_customer_id: customerId, value: '1' },
  })
  ```
  Guard: if `STRIPE_PRICE_OVERAGE`/Stripe isn't configured or `customerId` is missing, skip silently (log at debug). A small helper `emitOverageEvent(customerId, conversationId)` isolates the Stripe call so `prepareTurn` stays readable and the helper is independently reviewable.

Extracted so the agent-turn path takes no hard Stripe dependency when billing is unconfigured (self-host): the helper early-returns if `STRIPE_SECRET_KEY` is unset.

## 7. Read surface (`GET /billing` + web Billing page)

- `GET /billing` adds to its response: `includedCap`, `used` (`usage.periodConversationCount`, period-reset applied consistently with `prepareTurn`), `overageCount = max(0, used − includedCap)`, `estOverageUsd = round(overageCount × OVERAGE_RATE_USD, 2)`, and `ceiling`.
- **Web Billing page** ([apps/web/src/app/dashboard/billing/page.tsx](../../../apps/web/src/app/dashboard/billing/page.tsx)): show "X / includedCap included conversations used this period"; when `overageCount > 0`, add "Y over your plan — an estimated $Z this period ($0.05 each)." Trial banner logic unchanged.

## 8. Environment

New api env: `STRIPE_PRICE_OVERAGE` (metered price id) and `STRIPE_OVERAGE_METER_EVENT` (default `ayooda_overage_conversations`). Add to the optional Stripe block in `apps/api/.env.example` and the billing section of `docs/self-hosting.md`.

## 9. Error handling

- Meter-event emission is **non-fatal**: any Stripe error is caught and logged; the conversation proceeds. (Under-billing on a transient failure is acceptable; blocking a paying customer's chat is not.)
- Idempotency via `identifier: conversationId` — a retried/duplicated turn for the same conversation never double-counts (Stripe dedups on identifier within the meter).
- `STRIPE_PRICE_OVERAGE` unset → checkout falls back to flat-only (logged); the meter helper no-ops. Billing keeps working without overage.
- Ceiling: `used >= ceiling` → `402` `ceiling_reached`; the widget shows its generic plan-limit bubble, the owner sees the reason via `GET /billing`/gated response.
- `planFor(tier)` unknown (transient sync) → fail open (entitled, no overage) — unchanged safety posture.

## 10. Testing & verification

- **Unit (`bun test`, `entitlement.test.ts` extended):** active sub, `used < includedCap` → `entitled`, `overage:false`; `used === includedCap` and `< ceiling` → `entitled`, `overage:true`; `used === ceiling` → `!entitled`, `reason:'ceiling_reached'`; `past_due` mirrors active (grace) with overage; trial at cap → gated (`overage:false`, unchanged); the `includedCap`/`ceiling` values per tier. A small pure helper for `overageCount`/`estOverageUsd` if extracted is unit-tested.
- **Live E2E (Stripe test mode):** run the extended `setup-stripe.ts` (meter + overage price created); subscribe a test workspace (subscription has both items); drive conversations past `includedCap` → they continue, a **meter event** is visible on the Stripe customer and the upcoming invoice shows metered usage; the Billing page shows the overage count + estimate; push to `ceiling` → `402 ceiling_reached`; re-run a conversation with the same `conversationId` → no second meter event (dedup). Run `backfill-overage-item.ts` against a pre-existing subscription → the overage item is added. Clean up test data.

## Out of scope

Changing the $0.05 rate or the included amounts; annual/quarterly billing; overage for trials; graduated/tiered metered pricing (we report overage-only units against a flat $0.05 price); per-message (vs per-conversation) metering; credit-note / proration logic (Stripe's metered invoicing handles it); a self-serve rate/ceiling editor.
