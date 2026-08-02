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
