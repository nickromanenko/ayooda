import { describe, expect, test } from 'bun:test'
import { confidenceSummary, knowledgeConfidence, utcDateKey } from './confidence'

describe('knowledge confidence', () => {
  test('uses the strongest normalized retrieval score', () => {
    expect(knowledgeConfidence([])).toBe(0)
    expect(knowledgeConfidence([{ score: 0.64 }, { score: 0.918 }])).toBe(92)
    expect(knowledgeConfidence([{ score: 4 }])).toBe(100)
    expect(knowledgeConfidence([{ score: -1 }])).toBe(0)
  })

  test('uses stable UTC day keys', () => {
    expect(utcDateKey(new Date('2026-08-23T23:59:59Z'))).toBe('2026-08-23')
  })

  test('builds overall metrics and a zero-filled 30-day trend', () => {
    const result = confidenceSummary(
      [
        { date: '2026-08-22', confidenceSum: 60, confidenceSamples: 1, confidenceLowSamples: 1 },
        { date: '2026-08-23', confidenceSum: 180, confidenceSamples: 2 },
      ],
      new Date('2026-08-23T12:00:00Z'),
    )
    expect(result.average).toBe(80)
    expect(result.lowRate).toBe(33)
    expect(result.count).toBe(3)
    expect(result.threshold).toBe(70)
    expect(result.trend).toHaveLength(30)
    expect(result.trend.at(-2)).toEqual({ date: '2026-08-22', average: 60, count: 1 })
    expect(result.trend.at(-1)).toEqual({ date: '2026-08-23', average: 90, count: 2 })
    expect(result.trend[0]?.average).toBeNull()
  })

  test('handles empty and malformed counters', () => {
    const result = confidenceSummary([{ date: 'bad', confidenceSum: 'x', confidenceSamples: -1 }], new Date('2026-08-23T12:00:00Z'))
    expect(result.average).toBeNull()
    expect(result.lowRate).toBeNull()
    expect(result.count).toBe(0)
  })
})
