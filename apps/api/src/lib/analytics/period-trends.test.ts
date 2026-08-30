import { describe, expect, test } from 'bun:test'
import { periodTrends } from './period-trends'

const now = new Date('2026-08-30T12:00:00Z')
const stamp = (daysAgo: number) => ({ toDate: () => new Date(now.getTime() - daysAgo * 86_400_000) })

describe('usage period trends', () => {
  test('compares the latest 30 days with the preceding 30 days', () => {
    const result = periodTrends([
      { createdAt: stamp(2), status: 'resolved', hadTakeover: false, score: 5, firstReplyMs: 1_000 },
      { createdAt: stamp(3), status: 'waiting', hadTakeover: true, score: 3, firstReplyMs: 3_000 },
      { createdAt: stamp(35), status: 'resolved', hadTakeover: true, score: 3, firstReplyMs: 4_000 },
    ], now)
    expect(result.conversations).toEqual({ current: 2, previous: 1, delta: 1 })
    expect(result.automationRate).toEqual({ current: 100, previous: 0, delta: 100 })
    expect(result.handoffRate).toEqual({ current: 50, previous: 100, delta: -50 })
    expect(result.csat).toEqual({ current: 4, previous: 3, delta: 1 })
    expect(result.firstReplyMs).toEqual({ current: 2_000, previous: 4_000, delta: -2_000 })
  })

  test('keeps unavailable comparisons null instead of inventing zeroes', () => {
    const result = periodTrends([{ createdAt: stamp(1), status: 'resolved' }], now)
    expect(result.automationRate).toEqual({ current: 100, previous: null, delta: null })
    expect(result.csat).toEqual({ current: null, previous: null, delta: null })
  })
})
