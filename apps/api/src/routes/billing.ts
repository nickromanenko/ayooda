import { Hono } from 'hono'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, requireOwner, type AuthVariables } from '../middleware/auth'
import { getStripe, PRICE_BY_TIER, tierForPrice } from '../lib/billing/stripe'
import { checkEntitlement } from '../lib/billing/entitlement'
import { subscriptionPeriodEnd, subscriptionPriceId } from '../lib/billing/stripe-sync'
import { PLANS, planFor, type PlanTier, type Subscription } from '@ayooda/shared'

const billing = new Hono<{ Variables: AuthVariables }>()

// ---- Webhook (PUBLIC, raw body, no auth) — registered before any auth middleware ----
billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return c.json({ error: 'Missing signature' }, 400)

  const raw = await c.req.text()
  let event
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, sig, secret)
  } catch (err) {
    console.warn('[billing/webhook] signature verification failed:', err)
    return c.json({ error: 'Invalid signature' }, 400)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as { client_reference_id?: string | null; customer?: string | null; subscription?: string | null }
      const workspaceId = s.client_reference_id ?? undefined
      if (workspaceId && s.subscription) {
        const sub = await getStripe().subscriptions.retrieve(s.subscription)
        await applySubscription(workspaceId, sub, s.customer ?? null)
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as { id: string; status: string; metadata?: Record<string, string>; customer?: string | null; items?: { data: Array<{ price?: { id?: string } }> }; current_period_end?: number }
      const workspaceId = sub.metadata?.workspaceId
      if (workspaceId) await applySubscription(workspaceId, sub, sub.customer ?? null)
    }
    // other event types: acknowledge and ignore
  } catch (err) {
    console.error('[billing/webhook] handler error:', err)
    // Still 200 to avoid Stripe retry storms on our internal errors; logged for follow-up
  }
  return c.json({ received: true })
})

/** Map a Stripe subscription object onto the workspace's `subscription` field. */
async function applySubscription(
  workspaceId: string,
  sub: { status: string; items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> }; current_period_end?: number; id?: string },
  customerId: string | null,
): Promise<void> {
  const priceId = subscriptionPriceId(sub)
  const tier: PlanTier | null = priceId ? tierForPrice(priceId) : null
  const status: Subscription['status'] =
    sub.status === 'active' || sub.status === 'trialing' ? 'active'
    : sub.status === 'past_due' ? 'past_due'
    : 'canceled' // canceled/unpaid/incomplete/incomplete_expired/paused → not entitled (fail closed)

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)
  const workspaceSnap = await workspaceRef.get()
  if (!workspaceSnap.exists) {
    console.warn(`[billing/webhook] unknown workspace ${workspaceId}, ignoring event`)
    return
  }

  await workspaceRef.update({
    'subscription.status': status,
    'subscription.tier': tier,
    'subscription.currentPeriodEnd': subscriptionPeriodEnd(sub),
    'subscription.stripeCustomerId': customerId,
    'subscription.stripeSubscriptionId': sub.id ?? null,
  })
}

// ---- Authenticated endpoints ----
// Scoped to the specific authenticated subpaths only — NOT a broad `use('/')` — so the
// public `/webhook` route above is never caught by auth middleware.
billing.use('/checkout', requireAuth)
billing.use('/checkout', requireOwner)
billing.use('/portal', requireAuth)
billing.use('/portal', requireOwner)

billing.get('/', requireAuth, requireOwner, async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  const data = snap.data()!
  const rawSub = data.subscription as (Subscription & { trialEndsAt?: any; currentPeriodEnd?: any }) | undefined
  const sub: Subscription | undefined = rawSub
    ? {
        ...rawSub,
        trialEndsAt: rawSub.trialEndsAt?.toDate?.() ?? rawSub.trialEndsAt ?? null,
        currentPeriodEnd: rawSub.currentPeriodEnd?.toDate?.() ?? rawSub.currentPeriodEnd ?? null,
      }
    : undefined
  const usage = data.usage ?? {}
  const ent = checkEntitlement({
    subscription: sub,
    periodConversationCount: usage.periodConversationCount ?? 0,
    workspaceCreatedAt: data.createdAt?.toDate?.() ?? new Date(0),
    now: new Date(),
  })
  return c.json({
    subscription: sub ? {
      status: sub.status, tier: sub.tier,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      // never return stripeCustomerId/stripeSubscriptionId
    } : null,
    usage: { periodConversationCount: usage.periodConversationCount ?? 0 },
    entitled: ent.entitled, reason: ent.reason, cap: ent.cap, tier: ent.tier,
    plans: PLANS,
  })
})

billing.post('/checkout', async (c) => {
  const workspaceId = c.get('workspaceId')
  const body = await c.req.json<{ tier?: PlanTier }>()
  if (!body.tier || !planFor(body.tier)) return c.json({ error: 'Invalid tier' }, 400)
  const price = PRICE_BY_TIER[body.tier]
  if (!price) return c.json({ error: 'Plan not configured' }, 500)

  const ref = adminDb.doc(`workspaces/${workspaceId}`)
  const data = (await ref.get()).data()!
  let customerId: string | null = data.subscription?.stripeCustomerId ?? null
  if (!customerId) {
    const customer = await getStripe().customers.create({ metadata: { workspaceId } })
    customerId = customer.id
    await ref.update({ 'subscription.stripeCustomerId': customerId })
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: workspaceId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspaceId } },
    success_url: process.env.BILLING_SUCCESS_URL!,
    cancel_url: process.env.BILLING_CANCEL_URL!,
  })
  return c.json({ url: session.url })
})

billing.post('/portal', async (c) => {
  const workspaceId = c.get('workspaceId')
  const data = (await adminDb.doc(`workspaces/${workspaceId}`).get()).data()!
  const customerId = data.subscription?.stripeCustomerId
  if (!customerId) return c.json({ error: 'No billing account yet' }, 400)
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: process.env.BILLING_SUCCESS_URL!,
  })
  return c.json({ url: session.url })
})

export default billing
