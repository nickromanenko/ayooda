import { describe, expect, test } from 'bun:test'
import { adminPageLimit, decodeAdminCursor, encodeAdminCursor, normalizedAdminQuery } from './pagination'

describe('admin pagination', () => {
  test('bounds page size', () => {
    expect(adminPageLimit(undefined)).toBe(25)
    expect(adminPageLimit('0')).toBe(25)
    expect(adminPageLimit('20')).toBe(20)
    expect(adminPageLimit('1000')).toBe(100)
  })

  test('round-trips only safe document ids', () => {
    expect(decodeAdminCursor(encodeAdminCursor('abc_123-x'))).toBe('abc_123-x')
    expect(decodeAdminCursor(Buffer.from(JSON.stringify({ id: '../users/x' })).toString('base64url'))).toBeNull()
    expect(decodeAdminCursor('not-json')).toBeNull()
  })

  test('normalizes and bounds search input', () => {
    expect(normalizedAdminQuery('  Kim@Example.COM ')).toBe('kim@example.com')
    expect(normalizedAdminQuery('x'.repeat(120))).toHaveLength(100)
  })
})
