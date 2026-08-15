import { describe, expect, test } from 'bun:test'
import { checkCopilotEntitlement } from './copilot-entitlement'
import type { Subscription } from '@ayooda/shared'

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  status: 'active', tier: 'core', trialEndsAt: null, currentPeriodEnd: null,
  stripeCustomerId: null, stripeSubscriptionId: null, ...over,
})

describe('checkCopilotEntitlement', () => {
  test('uses the plan cap for a paid tier', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 999 }))
      .toEqual({ entitled: true, cap: 1000 })
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'core' }), copilotPeriodCount: 1000 }))
      .toEqual({ entitled: false, cap: 1000 })
  })

  test('lite and max use their own caps', () => {
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 199 }).entitled).toBe(true)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'lite' }), copilotPeriodCount: 200 }).entitled).toBe(false)
    expect(checkCopilotEntitlement({ subscription: sub({ tier: 'max' }), copilotPeriodCount: 2999 }).entitled).toBe(true)
  })

  test('a trial workspace falls back to the trial cap, not a plan cap', () => {
    // tier is null on trial — PlanDef has no trial row, so planFor() returns undefined.
    const r = checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 49 })
    expect(r).toEqual({ entitled: true, cap: 50 })
    expect(checkCopilotEntitlement({ subscription: sub({ status: 'trialing', tier: null }), copilotPeriodCount: 50 }).entitled).toBe(false)
  })

  test('no subscription at all is treated as trial', () => {
    expect(checkCopilotEntitlement({ subscription: undefined, copilotPeriodCount: 0 }))
      .toEqual({ entitled: true, cap: 50 })
  })

  test('a missing counter is treated as zero', () => {
    expect(checkCopilotEntitlement({ subscription: sub(), copilotPeriodCount: undefined }).entitled).toBe(true)
  })
})
