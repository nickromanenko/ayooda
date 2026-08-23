import { describe, expect, test } from 'bun:test'
import { aggregateHandoffCauses, csvCell } from './agent-usage'

describe('csvCell', () => {
  test('passes a plain value through', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(null)).toBe('')
  })

  test('quotes a value containing a comma', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
  })

  test('escapes embedded double quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  test('collapses newlines', () => {
    expect(csvCell('line1\nline2')).toBe('line1 line2')
  })
})

describe('aggregateHandoffCauses', () => {
  test('groups rule escalations and manual takeovers', () => {
    expect(aggregateHandoffCauses([
      { id: 'a', escalationReason: 'Low confidence', status: 'waiting' },
      { id: 'b', escalationReason: 'Low confidence', hadTakeover: true },
      { id: 'c', hadTakeover: true },
    ])).toEqual({
      total: 3,
      causes: [
        { reason: 'Low confidence', count: 2, percentage: 67 },
        { reason: 'Manual takeover', count: 1, percentage: 33 },
      ],
    })
  })

  test('deduplicates query overlap and ignores ordinary conversations', () => {
    expect(aggregateHandoffCauses([
      { id: 'a', escalationReason: 'Asked for a human', status: 'waiting' },
      { id: 'a', escalationReason: 'Asked for a human', hadTakeover: true },
      { id: 'b', status: 'resolved' },
    ])).toEqual({
      total: 1,
      causes: [{ reason: 'Asked for a human', count: 1, percentage: 100 }],
    })
  })

  test('bounds the response and rolls smaller causes into Other', () => {
    const result = aggregateHandoffCauses(Array.from({ length: 9 }, (_, i) => ({
      id: String(i), escalationReason: `Reason ${i}`, status: 'waiting',
    })))
    expect(result.total).toBe(9)
    expect(result.causes).toHaveLength(8)
    expect(result.causes.at(-1)).toEqual({ reason: 'Other', count: 2, percentage: 22 })
  })
})
