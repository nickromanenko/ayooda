import { describe, expect, test } from 'bun:test'
import { canHideBranding } from './branding'

describe('canHideBranding', () => {
  test('allows an active Core plan', () => {
    expect(canHideBranding({ status: 'active', tier: 'core' })).toBe(true)
  })

  test('allows an active Max plan', () => {
    expect(canHideBranding({ status: 'active', tier: 'max' })).toBe(true)
  })

  // past_due is a grace window on a plan that is already paid for.
  test('allows past_due on a qualifying tier', () => {
    expect(canHideBranding({ status: 'past_due', tier: 'core' })).toBe(true)
  })

  test('refuses Lite — below the minimum tier', () => {
    expect(canHideBranding({ status: 'active', tier: 'lite' })).toBe(false)
  })

  // The cases that matter most: a workspace that once qualified must lose the
  // benefit the moment its plan stops being live.
  test.each([
    ['a trial', { status: 'trialing', tier: null }],
    ['a cancelled plan', { status: 'canceled', tier: 'max' }],
    ['an expired plan', { status: 'expired', tier: 'max' }],
    ['a plan with no tier', { status: 'active', tier: null }],
    ['an unknown status', { status: 'weird', tier: 'max' }],
  ])('refuses %s', (_label, sub) => {
    expect(canHideBranding(sub)).toBe(false)
  })

  test.each([undefined, null, 'nope', 42])('refuses a malformed subscription %p', (sub) => {
    expect(canHideBranding(sub)).toBe(false)
  })
})
