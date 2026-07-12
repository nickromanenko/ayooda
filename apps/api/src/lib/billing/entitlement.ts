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
    const s = sub as Subscription
    const plan = planFor(s.tier)
    const reason: GateReason = status === 'past_due' ? 'past_due' : 'ok'
    // Unknown tier on an active subscription (transient sync state): fail open — never
    // wrongfully lock out a paying customer.
    if (!plan) return { entitled: true, reason, cap: 0, tier: s.tier }
    if (used >= plan.conversationCap) {
      return { entitled: false, reason: 'over_cap', cap: plan.conversationCap, tier: s.tier }
    }
    return { entitled: true, reason, cap: plan.conversationCap, tier: s.tier }
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
