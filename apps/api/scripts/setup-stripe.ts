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
