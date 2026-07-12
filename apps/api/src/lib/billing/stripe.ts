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
