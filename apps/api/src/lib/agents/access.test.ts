import { describe, expect, test } from 'bun:test'
import { canEditAgent } from '@ayooda/shared'

describe('canEditAgent', () => {
  test('an owner may edit any agent, listed or not', () => {
    expect(canEditAgent('owner', [], 'u1')).toBe(true)
    expect(canEditAgent('owner', undefined, 'u1')).toBe(true)
  })

  test('a member may edit an agent they are listed on', () => {
    expect(canEditAgent('member', ['u1', 'u2'], 'u2')).toBe(true)
  })

  test('a member may not edit an agent they are not listed on', () => {
    expect(canEditAgent('member', ['u1'], 'u2')).toBe(false)
    expect(canEditAgent('member', [], 'u2')).toBe(false)
    expect(canEditAgent('member', undefined, 'u2')).toBe(false)
  })

  // Fail closed on anything malformed rather than guessing.
  test.each([
    ['no uid', 'member' as const, ['u1'], undefined],
    ['no role', undefined, ['u1'], 'u1'],
    ['a non-array list', 'member' as const, 'u1' as never, 'u1'],
  ])('refuses with %s', (_label, role, list, uid) => {
    expect(canEditAgent(role, list as never, uid)).toBe(false)
  })
})
