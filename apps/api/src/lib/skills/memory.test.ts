import { describe, expect, test } from 'bun:test'
import { liveFacts, formatMemoryBlock, mergeFacts, nextExpiry, MAX_FACTS } from './memory'
import type { VisitorMemoryFact } from '@ayooda/shared'

const now = new Date('2026-08-14T12:00:00Z')
const fact = (over: Partial<VisitorMemoryFact> = {}): VisitorMemoryFact => ({
  id: 'f1', text: 'Prefers email', createdAt: now, expiresAt: new Date('2026-09-14T12:00:00Z'), ...over,
})

describe('liveFacts', () => {
  test('drops facts at or past their expiry', () => {
    const live = fact({ id: 'live' })
    const dead = fact({ id: 'dead', expiresAt: new Date('2026-08-14T11:59:59Z') })
    const exact = fact({ id: 'exact', expiresAt: now })
    expect(liveFacts([live, dead, exact], now).map((f) => f.id)).toEqual(['live'])
  })
  test('an empty list stays empty', () => {
    expect(liveFacts([], now)).toEqual([])
  })
})

describe('formatMemoryBlock', () => {
  test('returns null when there is nothing to recall', () => {
    expect(formatMemoryBlock([])).toBeNull()
  })
  test('renders one bullet per fact', () => {
    const block = formatMemoryBlock([fact({ text: 'Name is Ada' }), fact({ id: 'f2', text: 'On the Core plan' })])
    expect(block).toContain('- Name is Ada')
    expect(block).toContain('- On the Core plan')
  })
})

describe('mergeFacts', () => {
  const id = (i: number) => `new${i}`
  test('appends new facts with an expiry derived from retentionDays', () => {
    const out = mergeFacts([], ['Name is Ada'], now, 90, id)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('Name is Ada')
    expect(out[0]!.expiresAt.toISOString()).toBe('2026-11-12T12:00:00.000Z')
  })
  test('dedupes case-insensitively against existing facts', () => {
    const out = mergeFacts([fact({ text: 'Prefers email' })], ['prefers EMAIL', 'New thing'], now, 90, id)
    expect(out.map((f) => f.text)).toEqual(['Prefers email', 'New thing'])
  })
  test('dedupes within the incoming batch', () => {
    const out = mergeFacts([], ['Same', 'same'], now, 90, id)
    expect(out).toHaveLength(1)
  })
  test('ignores blank incoming facts', () => {
    expect(mergeFacts([], ['   ', ''], now, 90, id)).toHaveLength(0)
  })
  test('caps at MAX_FACTS by evicting oldest first', () => {
    const existing = Array.from({ length: MAX_FACTS }, (_, i) =>
      fact({ id: `old${i}`, text: `old ${i}`, createdAt: new Date(2026, 0, i + 1) }))
    const out = mergeFacts(existing, ['brand new'], now, 90, id)
    expect(out).toHaveLength(MAX_FACTS)
    expect(out.some((f) => f.id === 'old0')).toBe(false)
    expect(out.some((f) => f.text === 'brand new')).toBe(true)
  })
})

describe('nextExpiry', () => {
  test('returns the earliest expiry', () => {
    const soon = new Date('2026-08-20T00:00:00Z')
    expect(nextExpiry([fact(), fact({ id: 'f2', expiresAt: soon })])?.toISOString()).toBe(soon.toISOString())
  })
  test('returns null for no facts', () => {
    expect(nextExpiry([])).toBeNull()
  })
})
