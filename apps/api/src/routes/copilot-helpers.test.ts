import { describe, expect, test } from 'bun:test'
import { threadTitle, validateChatBody } from './copilot'

describe('threadTitle', () => {
  test('uses the message, truncated to 80 chars', () => {
    expect(threadTitle('How do refunds work?')).toBe('How do refunds work?')
    expect(threadTitle('x'.repeat(200))).toHaveLength(80)
  })
  test('trims and falls back for an empty message', () => {
    expect(threadTitle('   hi   ')).toBe('hi')
    expect(threadTitle('   ')).toBe('New thread')
  })
})

describe('validateChatBody', () => {
  test('accepts a continue request', () => {
    expect(validateChatBody({ message: 'hi', threadId: 't1' }))
      .toEqual({ ok: true, value: { message: 'hi', threadId: 't1' } })
  })
  test('accepts a start request', () => {
    expect(validateChatBody({ message: 'hi', agentId: 'a1' }))
      .toEqual({ ok: true, value: { message: 'hi', agentId: 'a1' } })
  })
  test('rejects neither threadId nor agentId', () => {
    expect(validateChatBody({ message: 'hi' }).ok).toBe(false)
  })
  test('rejects both together — ambiguous whether to start or continue', () => {
    expect(validateChatBody({ message: 'hi', threadId: 't1', agentId: 'a1' }).ok).toBe(false)
  })
  test('rejects an empty or missing message', () => {
    expect(validateChatBody({ threadId: 't1' }).ok).toBe(false)
    expect(validateChatBody({ message: '   ', threadId: 't1' }).ok).toBe(false)
    expect(validateChatBody(null).ok).toBe(false)
  })
})
