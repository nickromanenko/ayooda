import { describe, expect, test, beforeAll } from 'bun:test'

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret-please-change'
})

describe('crypto', () => {
  test('round-trips a secret', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const plain = 'sk-or-v1-abc123'
    const enc = encryptSecret(plain)
    expect(enc).not.toContain(plain)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(plain)
  })
  test('different ciphertext each call (random IV)', async () => {
    const { encryptSecret } = await import('./crypto')
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })
  test('rejects a tampered payload', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const enc = encryptSecret('secret')
    const parts = enc.split(':')
    // Flip a character in the ciphertext segment
    parts[3] = parts[3].slice(0, -1) + (parts[3].slice(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
})
