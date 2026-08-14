import { describe, expect, test } from 'bun:test'
import { idleCutoff, secretMatches, purgeFacts, IDLE_CLOSE_MINUTES, SWEEP_BATCH } from './sweep'
import type { VisitorMemoryFact } from '@ayooda/shared'

const now = new Date('2026-08-14T12:00:00Z')

describe('idleCutoff', () => {
  test('is IDLE_CLOSE_MINUTES before now', () => {
    expect(idleCutoff(now).toISOString()).toBe('2026-08-14T11:30:00.000Z')
    expect(IDLE_CLOSE_MINUTES).toBe(30)
  })
})

describe('secretMatches', () => {
  test('accepts an exact match and rejects everything else', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abd', 'abc')).toBe(false)
    expect(secretMatches('ab', 'abc')).toBe(false)
  })
  test('rejects when either side is empty, so an unset env var never opens the endpoint', () => {
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches('abc', '')).toBe(false)
    expect(secretMatches('', 'abc')).toBe(false)
  })
})

describe('purgeFacts', () => {
  const fact = (id: string, iso: string): VisitorMemoryFact =>
    ({ id, text: id, createdAt: now, expiresAt: new Date(iso) })

  test('drops expired facts and recomputes the next expiry', () => {
    const out = purgeFacts([fact('dead', '2026-08-01T00:00:00Z'), fact('live', '2026-09-01T00:00:00Z')], now)
    expect(out.facts.map((f) => f.id)).toEqual(['live'])
    expect(out.nextExpiryAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
  test('an all-expired document ends with a null next expiry', () => {
    const out = purgeFacts([fact('dead', '2026-08-01T00:00:00Z')], now)
    expect(out.facts).toEqual([])
    expect(out.nextExpiryAt).toBeNull()
  })
})

describe('batch size', () => {
  test('is bounded so a run has predictable cost', () => {
    expect(SWEEP_BATCH).toBe(100)
  })
})
