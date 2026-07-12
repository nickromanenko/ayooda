import { describe, expect, test } from 'bun:test'
import { subscriptionPeriodEnd, subscriptionPriceId } from './stripe-sync'

describe('subscriptionPeriodEnd', () => {
  test('reads item-level current_period_end (API 2026-06-24+)', () => {
    const d = subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1893456000 }] } })
    expect(d?.getTime()).toBe(1893456000 * 1000)
  })
  test('falls back to legacy top-level current_period_end', () => {
    const d = subscriptionPeriodEnd({ current_period_end: 1893456000 })
    expect(d?.getTime()).toBe(1893456000 * 1000)
  })
  test('item-level takes precedence over top-level', () => {
    const d = subscriptionPeriodEnd({ current_period_end: 1, items: { data: [{ current_period_end: 1893456000 }] } })
    expect(d?.getTime()).toBe(1893456000 * 1000)
  })
  test('null when neither present', () => {
    expect(subscriptionPeriodEnd({})).toBeNull()
    expect(subscriptionPeriodEnd({ items: { data: [] } })).toBeNull()
  })
})

describe('subscriptionPriceId', () => {
  test('reads the first item price id', () => {
    expect(subscriptionPriceId({ items: { data: [{ price: { id: 'price_x' } }] } })).toBe('price_x')
  })
  test('undefined when absent', () => {
    expect(subscriptionPriceId({})).toBeUndefined()
  })
})
