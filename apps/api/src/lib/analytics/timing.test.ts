import { describe, expect, test } from 'bun:test'
import { averageTiming, elapsedMs, timestampDate } from './timing'

describe('timing analytics', () => {
  test('reads Dates and Firestore-like timestamps', () => {
    const date = new Date('2026-08-23T10:00:00Z')
    expect(timestampDate(date)).toBe(date)
    expect(timestampDate({ toDate: () => date })).toBe(date)
    expect(timestampDate('2026-08-23')).toBeNull()
  })

  test('calculates elapsed milliseconds and clamps clock skew', () => {
    const start = new Date('2026-08-23T10:00:00Z')
    expect(elapsedMs(start, new Date('2026-08-23T10:00:01.500Z'))).toBe(1500)
    expect(elapsedMs(start, new Date('2026-08-23T09:59:59Z'))).toBe(0)
    expect(elapsedMs(null, new Date())).toBeNull()
  })

  test('averages valid tracked durations only', () => {
    expect(averageTiming([1000, 2000, 3001, null, -1, Number.NaN])).toEqual({ averageMs: 2000, count: 3 })
    expect(averageTiming([])).toEqual({ averageMs: null, count: 0 })
  })
})
