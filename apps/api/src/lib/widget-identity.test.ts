import { beforeAll, describe, expect, test } from 'bun:test'
import { createHmac } from 'crypto'

beforeAll(() => { process.env.API_KEY_ENCRYPTION_SECRET = 'identity-test-platform-secret' })

function token(payload: Record<string, unknown>, secret = 'customer-secret') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

describe('widget identity JWT', () => {
  test('accepts valid claims and normalizes customer data', async () => {
    const { verifyWidgetIdentityToken } = await import('./widget-identity')
    const now = 2_000_000_000
    expect(verifyWidgetIdentityToken(token({ sub: 'customer-42', aud: 'ayooda-widget:channel-1', iat: now, exp: now + 600, name: ' Ada ', email: 'ADA@EXAMPLE.COM' }), 'customer-secret', 'channel-1', now * 1000)).toEqual({ externalId: 'customer-42', name: 'Ada', email: 'ada@example.com' })
  })

  test('rejects tampering, a wrong audience, expiry, and long-lived tokens', async () => {
    const { verifyWidgetIdentityToken } = await import('./widget-identity')
    const now = 2_000_000_000
    const base = { sub: '42', aud: 'ayooda-widget:channel-1', iat: now, exp: now + 600 }
    expect(() => verifyWidgetIdentityToken(`${token(base)}x`, 'customer-secret', 'channel-1', now * 1000)).toThrow()
    expect(() => verifyWidgetIdentityToken(token({ ...base, aud: 'ayooda-widget:other' }), 'customer-secret', 'channel-1', now * 1000)).toThrow()
    expect(() => verifyWidgetIdentityToken(token({ ...base, exp: now - 61 }), 'customer-secret', 'channel-1', now * 1000)).toThrow()
    expect(() => verifyWidgetIdentityToken(token({ ...base, exp: now + 901 }), 'customer-secret', 'channel-1', now * 1000)).toThrow()
  })

  test('derives a stable opaque visitor ID without exposing the external ID', async () => {
    const { authenticatedVisitorId } = await import('./widget-identity')
    const first = authenticatedVisitorId('workspace', 'channel', 'customer@example.com')
    expect(first).toBe(authenticatedVisitorId('workspace', 'channel', 'customer@example.com'))
    expect(first).not.toContain('customer@example.com')
  })

  test('accepts a previous signing secret only during the rotation grace period', async () => {
    const { channelIdentitySecrets } = await import('./widget-identity')
    const { encryptSecret } = await import('./crypto')
    const now = Date.now()
    const data = {
      identitySigningSecretEnc: encryptSecret('current'),
      identityPreviousSigningSecretEnc: encryptSecret('previous'),
      identityPreviousSecretExpiresAt: new Date(now + 1000),
    }
    expect(channelIdentitySecrets(data, now)).toEqual(['current', 'previous'])
    expect(channelIdentitySecrets(data, now + 1001)).toEqual(['current'])
  })
})
