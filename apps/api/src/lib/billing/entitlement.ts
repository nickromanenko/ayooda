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
  const status = sub?.status ?? 'expired' // missing subscription = old workspace, no active plan

  // Active or past_due (grace) subscription: allow overage up to a safety ceiling.
  if (status === 'active' || status === 'past_due') {
    const s = sub as Subscription
    const plan = planFor(s.tier)
    const reason: GateReason = status === 'past_due' ? 'past_due' : 'ok'
    // Unknown tier on an active subscription (transient sync state): fail open — never
    // wrongfully lock out a paying customer.
    if (!plan) return { entitled: true, reason, includedCap: 0, ceiling: 0, overage: false, tier: s.tier }
    const includedCap = plan.conversationCap
    const ceiling = includedCap * OVERAGE_CEILING_MULTIPLIER
    if (used >= ceiling) return { entitled: false, reason: 'ceiling_reached', includedCap, ceiling, overage: false, tier: s.tier }
    return { entitled: true, reason, includedCap, ceiling, overage: used >= includedCap, tier: s.tier }
  }

  // Trial — hard cap (no card to bill overage against)
  if (status === 'trialing') {
    const ends = sub?.trialEndsAt ?? null
    const includedCap = TRIAL_CONVERSATION_CAP
    if (ends && now >= ends) return { entitled: false, reason: 'trial_expired', includedCap, ceiling: includedCap, overage: false, tier: null }
    if (used >= includedCap) return { entitled: false, reason: 'over_cap', includedCap, ceiling: includedCap, overage: false, tier: null }
    return { entitled: true, reason: 'ok', includedCap, ceiling: includedCap, overage: false, tier: null }
  }

  // canceled / expired / missing
  if (status === 'canceled') return { entitled: false, reason: 'no_subscription', includedCap: 0, ceiling: 0, overage: false, tier: sub?.tier ?? null }
  return { entitled: false, reason: 'trial_expired', includedCap: 0, ceiling: 0, overage: false, tier: null }
}

export function shouldResetPeriod(
  periodStart: Date | null,
  now: Date,
  subscription: Subscription | undefined,
): boolean {
  if (!periodStart) return true
  // Subscribers: reset when the Stripe billing period rolls over
  if (subscription?.status === 'active' || subscription?.status === 'past_due') {
    // Billing period is authoritative for subscribers. If it's not known yet, don't reset.
    return subscription.currentPeriodEnd ? now >= subscription.currentPeriodEnd : false
  }
  // Trial / no subscription: reset on calendar-month change
  return (
    now.getUTCFullYear() !== periodStart.getUTCFullYear() ||
    now.getUTCMonth() !== periodStart.getUTCMonth()
  )
}
