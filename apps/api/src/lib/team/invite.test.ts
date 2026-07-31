import { describe, expect, test } from 'bun:test'
import { normalizeInviteEmail } from './invite'

describe('normalizeInviteEmail', () => {
  test('trims and lowercases', () => {
    expect(normalizeInviteEmail('  Alice@Example.COM ')).toEqual({ ok: true, email: 'alice@example.com' })
  })
  test('rejects empty', () => {
    expect(normalizeInviteEmail('   ').ok).toBe(false)
  })
  test('rejects missing @', () => {
    expect(normalizeInviteEmail('notanemail').ok).toBe(false)
  })
  test('rejects @ with no local or domain part', () => {
    expect(normalizeInviteEmail('@example.com').ok).toBe(false)
    expect(normalizeInviteEmail('alice@').ok).toBe(false)
  })
  test('rejects over-length (>254)', () => {
    const long = 'a'.repeat(250) + '@x.com'
    expect(normalizeInviteEmail(long).ok).toBe(false)
  })
  test('accepts a normal address', () => {
    expect(normalizeInviteEmail('bob.smith+tag@sub.example.io')).toEqual({ ok: true, email: 'bob.smith+tag@sub.example.io' })
  })
})
