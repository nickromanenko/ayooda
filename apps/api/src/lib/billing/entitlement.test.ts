import { describe, expect, test } from 'bun:test'
import { checkEntitlement, shouldResetPeriod } from './entitlement'
import type { Subscription } from '@ayooda/shared'

const base = (over: Partial<Subscription>): Subscription => ({
  status: 'trialing', tier: null, trialEndsAt: null, currentPeriodEnd: null,
  stripeCustomerId: null, stripeSubscriptionId: null, ...over,
})
const created = new Date('2026-01-01T00:00:00Z')

describe('checkEntitlement', () => {
  test('active subscription under included cap → entitled, no overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'core' }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date() })
    expect(r).toEqual({ entitled: true, reason: 'ok', includedCap: 500, ceiling: 5000, overage: false, tier: 'core' })
  })
  test('active subscription at/over included cap but under ceiling → entitled + overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'lite' }), periodConversationCount: 100, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.overage).toBe(true); expect(r.includedCap).toBe(100); expect(r.ceiling).toBe(1000)
  })
  test('active subscription at the ceiling → ceiling_reached', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: 'lite' }), periodConversationCount: 1000, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('ceiling_reached'); expect(r.overage).toBe(false)
  })
  test('past_due under cap → entitled, no overage (grace)', () => {
    const r = checkEntitlement({ subscription: base({ status: 'past_due', tier: 'lite' }), periodConversationCount: 5, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.reason).toBe('past_due'); expect(r.overage).toBe(false)
  })
  test('past_due at/over cap under ceiling → entitled + overage (grace)', () => {
    const r = checkEntitlement({ subscription: base({ status: 'past_due', tier: 'lite' }), periodConversationCount: 150, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.reason).toBe('past_due'); expect(r.overage).toBe(true)
  })
  test('trial active under trial cap → entitled, no overage', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 10, workspaceCreatedAt: created, now: new Date('2026-01-10T00:00:00Z') })
    expect(r).toEqual({ entitled: true, reason: 'ok', includedCap: 50, ceiling: 50, overage: false, tier: null })
  })
  test('trial active over trial cap → over_cap', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 50, workspaceCreatedAt: created, now: new Date('2026-01-10T00:00:00Z') })
    expect(r.reason).toBe('over_cap'); expect(r.entitled).toBe(false)
  })
  test('trial expired → trial_expired', () => {
    const r = checkEntitlement({ subscription: base({ status: 'trialing', trialEndsAt: new Date('2026-01-15T00:00:00Z') }), periodConversationCount: 0, workspaceCreatedAt: created, now: new Date('2026-02-01T00:00:00Z') })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('trial_expired')
  })
  test('canceled → no_subscription', () => {
    const r = checkEntitlement({ subscription: base({ status: 'canceled', tier: 'core' }), periodConversationCount: 0, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('no_subscription')
  })
  test('missing subscription on an old workspace → trial_expired', () => {
    const r = checkEntitlement({ subscription: undefined, periodConversationCount: 0, workspaceCreatedAt: created, now: new Date('2026-03-01T00:00:00Z') })
    expect(r.entitled).toBe(false); expect(r.reason).toBe('trial_expired')
  })
  test('active subscription with unknown tier fails open (no wrongful lockout)', () => {
    const r = checkEntitlement({ subscription: base({ status: 'active', tier: null }), periodConversationCount: 0, workspaceCreatedAt: created, now: new Date() })
    expect(r.entitled).toBe(true); expect(r.reason).toBe('ok')
  })
})

describe('shouldResetPeriod', () => {
  test('same calendar month → false (trial)', () => {
    expect(shouldResetPeriod(new Date('2026-01-03'), new Date('2026-01-28'), base({}))).toBe(false)
  })
  test('crossed into a new month → true (trial)', () => {
    expect(shouldResetPeriod(new Date('2026-01-28'), new Date('2026-02-02'), base({}))).toBe(true)
  })
  test('null periodStart → true', () => {
    expect(shouldResetPeriod(null, new Date(), base({}))).toBe(true)
  })
  test('subscriber: now past currentPeriodEnd → true', () => {
    expect(shouldResetPeriod(new Date('2026-01-01'), new Date('2026-02-10'), base({ status: 'active', currentPeriodEnd: new Date('2026-02-01') }))).toBe(true)
  })
  test('subscriber: now before currentPeriodEnd → false', () => {
    expect(shouldResetPeriod(new Date('2026-01-01'), new Date('2026-01-20'), base({ status: 'active', currentPeriodEnd: new Date('2026-02-01') }))).toBe(false)
  })
  test('subscriber with unknown currentPeriodEnd does not calendar-reset', () => {
    expect(shouldResetPeriod(new Date('2026-01-28'), new Date('2026-02-05'), base({ status: 'active', currentPeriodEnd: null }))).toBe(false)
  })
})
