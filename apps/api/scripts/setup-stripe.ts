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

// ─── Overage: a usage meter + a shared metered $0.05 price ───────────
const EVENT_NAME = 'ayooda_overage_conversations'
const meters = await stripe.billing.meters.list({ limit: 100 })
let meter = meters.data.find((m) => m.event_name === EVENT_NAME && m.status === 'active')
if (!meter) {
  meter = await stripe.billing.meters.create({
    display_name: 'Ayooda overage conversations',
    event_name: EVENT_NAME,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  })
}

let overageProduct = existing.data.find((p) => p.name === 'Ayooda Usage')
if (!overageProduct) overageProduct = await stripe.products.create({ name: 'Ayooda Usage' })
const overagePrices = await stripe.prices.list({ product: overageProduct.id, active: true, limit: 100 })
let overagePrice = overagePrices.data.find((p) => p.recurring?.usage_type === 'metered' && p.unit_amount === 5)
if (!overagePrice) {
  overagePrice = await stripe.prices.create({
    product: overageProduct.id,
    currency: 'usd',
    unit_amount: 5,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
  })
}
console.log(`STRIPE_PRICE_OVERAGE=${overagePrice.id}`)
console.log(`STRIPE_OVERAGE_METER_EVENT=${EVENT_NAME}`)

process.exit(0)
