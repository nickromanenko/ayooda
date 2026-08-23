import { describe, expect, test } from 'bun:test'
import { GATEWAY_KEY_MAX_LENGTH, gatewayKeyStatus, parseGatewayKeyBody, testGatewayKey } from './gateway-key'

describe('masked AI Gateway key status', () => {
  test('prefers an agent key without exposing it', () => {
    expect(gatewayKeyStatus('encrypted-secret', 'platform-secret')).toEqual({
      hasAgentKey: true,
      platformAvailable: true,
      source: 'agent',
    })
  })

  test('reports platform fallback and missing-key states', () => {
    expect(gatewayKeyStatus(undefined, 'platform-secret').source).toBe('platform')
    expect(gatewayKeyStatus(undefined, '')).toEqual({
      hasAgentKey: false,
      platformAvailable: false,
      source: 'none',
    })
  })
})

describe('AI Gateway key input', () => {
  test('trims a non-empty key', () => {
    expect(parseGatewayKeyBody({ apiKey: '  vck_live_key  ' })).toEqual({ ok: true, apiKey: 'vck_live_key' })
  })

  test('rejects missing, blank, non-string, and oversized keys', () => {
    expect(parseGatewayKeyBody(null).ok).toBe(false)
    expect(parseGatewayKeyBody({}).ok).toBe(false)
    expect(parseGatewayKeyBody({ apiKey: '   ' }).ok).toBe(false)
    expect(parseGatewayKeyBody({ apiKey: 42 }).ok).toBe(false)
    expect(parseGatewayKeyBody({ apiKey: 'x'.repeat(GATEWAY_KEY_MAX_LENGTH + 1) }).ok).toBe(false)
  })
})

describe('AI Gateway key verification', () => {
  test('accepts a key when the authenticated credit lookup succeeds', async () => {
    expect(await testGatewayKey('good', async (key) => {
      expect(key).toBe('good')
      return { balance: 0, total_used: 0 }
    })).toEqual({ ok: true })
  })

  test('classifies authentication failures as invalid keys', async () => {
    expect(await testGatewayKey('bad', async () => {
      throw { statusCode: 401 }
    })).toEqual({ ok: false, reason: 'invalid', error: 'AI Gateway rejected this key.' })
  })

  test('does not mistake a Gateway outage for an invalid key', async () => {
    expect(await testGatewayKey('unknown', async () => {
      throw new Error('network down')
    })).toEqual({
      ok: false,
      reason: 'unavailable',
      error: 'Could not verify the key with AI Gateway. Please try again.',
    })
  })
})
