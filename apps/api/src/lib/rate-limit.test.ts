import { describe, expect, test } from 'bun:test'
import { rateLimit, __resetRateLimit, __bucketCount } from './rate-limit'

describe('rateLimit', () => {
  test('allows up to the limit then rejects', () => {
    __resetRateLimit()
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, 0).ok).toBe(true)
    }
    const denied = rateLimit('k', 3, 1000, 0)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterMs).toBe(1000) // oldest at t=0, window 1000, now 0
  })

  test('window slides as the clock advances', () => {
    __resetRateLimit()
    expect(rateLimit('k', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('k', 1, 1000, 500).ok).toBe(false) // still in window
    expect(rateLimit('k', 1, 1000, 1000).ok).toBe(true) // first ts expired (>= now-window)
  })

  test('keys are independent', () => {
    __resetRateLimit()
    expect(rateLimit('a', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('b', 1, 1000, 0).ok).toBe(true)
  })

  test('retryAfterMs reflects the oldest in-window timestamp', () => {
    __resetRateLimit()
    rateLimit('k', 2, 1000, 100)
    rateLimit('k', 2, 1000, 300)
    const denied = rateLimit('k', 2, 1000, 800)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterMs).toBe(300) // oldest(100)+1000-800
  })

  test('sweeps out keys whose window has fully expired', () => {
    __resetRateLimit()
    rateLimit('gone', 5, 1000, 0)
    expect(__bucketCount()).toBe(1)
    // A later call past the window triggers the sweep; 'gone' has no live timestamps
    rateLimit('other', 5, 1000, 2000)
    expect(__bucketCount()).toBe(1) // only 'other' remains
  })
})
