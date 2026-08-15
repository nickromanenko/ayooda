import { describe, expect, test } from 'bun:test'
import { checkCopilotEntitlement } from './copilot-entitlement'
import type { Subscription } from '@ayooda/shared'

const NOW = new Date('2026-06-15T00:00:00Z')
const PAST = new Date('2026-01-01T00:00:00Z')
const FUTURE = new Date('2026-12-01T00:00:00Z')

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  status: 'active', tier: 'core', trialEndsAt: null, currentPeriodEnd: null,
  stripeCustomerId: null, stripeSubscriptionId: null, ...over,
})

describe('checkCopilotEntitlement', () => {
  test('uses the plan cap for a paid tier', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 999, now: NOW }))
      .toEqual({ entitled: true, cap: 1000, reason: 'ok' })
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 1000, now: NOW }))
      .toEqual({ entitled: false, cap: 1000, reason: 'ok' })
  })

  test('lite and max use their own caps', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 199, now: NOW }).entitled).toBe(true)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 200, now: NOW }).entitled).toBe(false)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'max' }), copilotPeriodCount: 2999, now: NOW }).entitled).toBe(true)
  })

  test('a trial workspace falls back to the trial cap, not a plan cap', () => {
    // tier is null on trial — PlanDef has no trial row, so planFor() returns undefined.
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 49, now: NOW })
    expect(r).toEqual({ entitled: true, cap: 50, reason: 'ok' })
    expect(checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 50, now: NOW }).entitled).toBe(false)
  })

  test('a missing counter is treated as zero', () => {
    expect(checkCopilotEntitlement({ subscription: sub(), copilotPeriodCount: undefined, now: NOW }).entitled).toBe(true)
  })

  test('an expired trial is not entitled, even with unused threads', () => {
    const r = checkCopilotEntitlement({
      subscription: sub({ status: 'trialing', tier: null, trialEndsAt: PAST }),
      copilotPeriodCount: 0,
      now: NOW,
    })
    expect(r).toEqual({ entitled: false, cap: 50, reason: 'trial_expired' })
  })

  test('a live trial (trialEndsAt in the future) is entitled', () => {
    const r = checkCopilotEntitlement({
      subscription: sub({ status: 'trialing', tier: null, trialEndsAt: FUTURE }),
      copilotPeriodCount: 0,
      now: NOW,
    })
    expect(r).toEqual({ entitled: true, cap: 50, reason: 'ok' })
  })

  test('a canceled subscription is not entitled, even on the max tier', () => {
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'canceled', tier: 'max' }), copilotPeriodCount: 0, now: NOW })
    expect(r).toEqual({ entitled: false, cap: 0, reason: 'no_subscription' })
  })

  test('an expired subscription is not entitled', () => {
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'expired', tier: 'core' }), copilotPeriodCount: 0, now: NOW })
    expect(r.entitled).toBe(false)
    expect(r.cap).toBe(0)
  })

  test('no subscription at all is not entitled (no free LLM spend without an active plan)', () => {
    expect(checkCopilotEntitlement({ subscription: undefined, copilotPeriodCount: 0, now: NOW }))
      .toEqual({ entitled: false, cap: 0, reason: 'no_subscription' })
  })

  test('past_due (grace period) with a valid tier is entitled at the plan cap', () => {
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'past_due', tier: 'core' }), copilotPeriodCount: 5, now: NOW })
    expect(r).toEqual({ entitled: true, cap: 1000, reason: 'past_due' })
  })

  test('active with an unrecognised tier fails open (transient Stripe sync state)', () => {
    const r = checkCopilotEntitlement({
      subscription: sub({ status: 'active', tier: 'unknown' as unknown as Subscription['tier'] }),
      copilotPeriodCount: 0,
      now: NOW,
    })
    expect(r).toEqual({ entitled: true, cap: 0, reason: 'ok' })
  })
})
