import { describe, expect, test, beforeAll, afterEach } from 'bun:test'
import { encryptSecret } from '../crypto'
import { resolveGatewayKey } from './resolve'

beforeAll(() => { process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret' })

const savedKey = process.env.AI_GATEWAY_API_KEY
afterEach(() => { if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = savedKey })

describe('resolveGatewayKey', () => {
  test('uses the decrypted agent key when present', () => {
    const enc = encryptSecret('agent-gw-key')
    expect(resolveGatewayKey(enc)).toEqual({ ok: true, apiKey: 'agent-gw-key' })
  })
  test('falls back to the platform AI_GATEWAY_API_KEY for any provider', () => {
    process.env.AI_GATEWAY_API_KEY = 'platform-gw-key'
    expect(resolveGatewayKey(undefined)).toEqual({ ok: true, apiKey: 'platform-gw-key' })
  })
  test('missing everything → not ok', () => {
    delete process.env.AI_GATEWAY_API_KEY
    expect(resolveGatewayKey(undefined)).toEqual({ ok: false, reason: 'missing_key' })
  })
})
