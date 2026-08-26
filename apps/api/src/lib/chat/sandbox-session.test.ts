import { describe, expect, test } from 'bun:test'
import {
  isSandboxSessionId,
  sandboxSessionPath,
  sandboxSessionsPath,
  validateSandboxChatBody,
} from './sandbox-session'

describe('sandbox session paths', () => {
  test('stay outside the production conversations collection', () => {
    expect(sandboxSessionsPath('w', 'u')).toBe('workspaces/w/sandboxUsers/u/sandboxSessions')
    expect(sandboxSessionPath('w', 'u', 's')).toBe('workspaces/w/sandboxUsers/u/sandboxSessions/s')
    expect(sandboxSessionPath('w', 'u', 's').split('/')).not.toContain('conversations')
  })
})

describe('sandbox request validation', () => {
  test('accepts a new or continuing session and defaults tools off', () => {
    expect(validateSandboxChatBody({ message: ' hello ' })).toEqual({
      ok: true, value: { message: 'hello', allowTools: false },
    })
    expect(validateSandboxChatBody({ message: 'hi', sessionId: null, allowTools: false })).toEqual({
      ok: true, value: { message: 'hi', allowTools: false },
    })
    expect(validateSandboxChatBody({ message: 'hi', sessionId: 'abc_123', allowTools: true })).toEqual({
      ok: true, value: { message: 'hi', sessionId: 'abc_123', allowTools: true },
    })
  })

  test('rejects empty, oversized, malformed session, and non-boolean tool inputs', () => {
    expect(validateSandboxChatBody({ message: ' ' }).ok).toBe(false)
    expect(validateSandboxChatBody({ message: 'x'.repeat(5_001) }).ok).toBe(false)
    expect(validateSandboxChatBody({ message: 'hi', sessionId: '../live' }).ok).toBe(false)
    expect(validateSandboxChatBody({ message: 'hi', allowTools: 'yes' }).ok).toBe(false)
  })

  test('allows only path-safe session ids', () => {
    expect(isSandboxSessionId('Abc-123_ok')).toBe(true)
    expect(isSandboxSessionId('has/slash')).toBe(false)
    expect(isSandboxSessionId('')).toBe(false)
  })
})
