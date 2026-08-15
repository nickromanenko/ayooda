import { planFor, TRIAL_COPILOT_CAP, type Subscription } from '@ayooda/shared'
import type { GateReason } from './entitlement'

export interface CopilotEntitlementInput {
  subscription: Subscription | undefined
  copilotPeriodCount: number | undefined
  now: Date
}

export interface CopilotEntitlementResult {
  entitled: boolean
  cap: number
  reason: GateReason
}

/**
 * Copilot has its own allowance and never touches the customer-conversation
 * quota. Checked once per thread, when its first message is written.
 *
 * Status ladder mirrors `checkEntitlement` in ./entitlement — a workspace
 * without an active plan (canceled, expired, or never subscribed) gets no
 * free LLM spend, even though Copilot isn't the billed product.
 */
export function checkCopilotEntitlement({
  subscription: sub,
  copilotPeriodCount,
  now,
}: CopilotEntitlementInput): CopilotEntitlementResult {
  const status = sub?.status ?? 'expired' // missing subscription = old workspace, no active plan
  const used = copilotPeriodCount ?? 0

  // Active or past_due (grace) subscription: the plan's Copilot cap.
  if (status === 'active' || status === 'past_due') {
    const s = sub as Subscription
    const plan = planFor(s.tier)
    const reason: GateReason = status === 'past_due' ? 'past_due' : 'ok'
    // Unknown tier on an active subscription (transient sync state): fail open — never
    // wrongfully lock out a paying customer.
    if (!plan) return { entitled: true, cap: 0, reason }
    return { entitled: used < plan.copilotCap, cap: plan.copilotCap, reason }
  }

  // Trial — hard cap (no card to bill overage against)
  if (status === 'trialing') {
    const ends = sub?.trialEndsAt ?? null
    const cap = TRIAL_COPILOT_CAP
    if (ends && now >= ends) return { entitled: false, cap, reason: 'trial_expired' }
    if (used >= cap) return { entitled: false, cap, reason: 'over_cap' }
    return { entitled: true, cap, reason: 'ok' }
  }

  // canceled / expired / missing — no active plan, no free Copilot spend
  return { entitled: false, cap: 0, reason: 'no_subscription' }
}
