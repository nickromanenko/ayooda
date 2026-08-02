import { getStripe } from './stripe'

/**
 * Report one overage conversation to Stripe metered billing. No-op when billing/overage
 * isn't configured (self-host) or the customer id is missing. Never throws.
 */
export async function emitOverageEvent(customerId: string | null | undefined, conversationId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_OVERAGE || !customerId) return
  try {
    await getStripe().billing.meterEvents.create({
      event_name: process.env.STRIPE_OVERAGE_METER_EVENT ?? 'ayooda_overage_conversations',
      identifier: conversationId,
      payload: { stripe_customer_id: customerId, value: '1' },
    })
  } catch (err) {
    console.warn('[overage] meter event failed:', err)
  }
}
