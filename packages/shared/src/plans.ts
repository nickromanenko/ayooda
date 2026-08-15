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
  /** Internal Copilot threads per period. A spend guard, not a billed line. */
  copilotCap: number
}

export const PLANS: readonly PlanDef[] = [
  { tier: 'lite', name: 'Lite', priceUsd: 25, conversationCap: 100, copilotCap: 200 },
  { tier: 'core', name: 'Core', priceUsd: 55, conversationCap: 500, copilotCap: 1000 },
  { tier: 'max', name: 'Max', priceUsd: 195, conversationCap: 1500, copilotCap: 3000 },
]

export const TRIAL_DAYS = 14
export const TRIAL_CONVERSATION_CAP = 50
export const TRIAL_COPILOT_CAP = 50

/** Overage: conversations beyond a plan's included pack are billed at this rate. */
export const OVERAGE_RATE_USD = 0.05
/** Safety ceiling for paying subscribers = includedCap × this multiplier. */
export const OVERAGE_CEILING_MULTIPLIER = 10

export function planFor(tier: PlanTier | null): PlanDef | undefined {
  return tier ? PLANS.find((p) => p.tier === tier) : undefined
}
