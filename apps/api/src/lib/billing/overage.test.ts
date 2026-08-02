import { describe, expect, test, afterEach } from 'bun:test'
import { emitOverageEvent } from './overage'

const savedKey = process.env.STRIPE_SECRET_KEY
const savedPrice = process.env.STRIPE_PRICE_OVERAGE
afterEach(() => {
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey
  if (savedPrice === undefined) delete process.env.STRIPE_PRICE_OVERAGE; else process.env.STRIPE_PRICE_OVERAGE = savedPrice
})

describe('emitOverageEvent', () => {
  test('no-ops (does not throw) when Stripe is unconfigured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_PRICE_OVERAGE
    await expect(emitOverageEvent('cus_123', 'conv_1')).resolves.toBeUndefined()
  })
  test('no-ops when the customer id is missing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_PRICE_OVERAGE = 'price_x'
    await expect(emitOverageEvent(null, 'conv_1')).resolves.toBeUndefined()
  })
})
