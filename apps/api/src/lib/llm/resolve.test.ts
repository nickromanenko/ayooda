import { describe, expect, test, beforeAll } from 'bun:test'

beforeAll(() => { process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret' })

describe('resolveOpenRouterKey', () => {
  test('uses the decrypted workspace key when present', async () => {
    const { encryptSecret } = await import('../crypto')
    const { resolveOpenRouterKey } = await import('./resolve')
    const enc = encryptSecret('sk-or-customer')
    expect(resolveOpenRouterKey('claude', enc)).toEqual({ ok: true, apiKey: 'sk-or-customer' })
  })
  test('falls back to platform key for gemini only', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-platform'
    const { resolveOpenRouterKey } = await import('./resolve')
    expect(resolveOpenRouterKey('gemini', undefined)).toEqual({ ok: true, apiKey: 'sk-or-platform' })
    expect(resolveOpenRouterKey('claude', undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
  test('missing everything → missing_key', async () => {
    delete process.env.OPENROUTER_API_KEY
    const { resolveOpenRouterKey } = await import('./resolve')
    expect(resolveOpenRouterKey('gemini', undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
})
