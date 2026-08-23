import { describe, expect, test } from 'bun:test'
import { verifySvixSignature } from './svix'

// Known-good vector from the Svix documentation.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const PAYLOAD = '{"test": 2432232314}'
const HEADERS = {
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}

describe('verifySvixSignature', () => {
  test('accepts a valid signature', () => {
    expect(verifySvixSignature(PAYLOAD, HEADERS, SECRET)).toBe(true)
  })

  test('rejects a tampered payload', () => {
    expect(verifySvixSignature('{"test": 999}', HEADERS, SECRET)).toBe(false)
  })

  test('rejects a wrong secret', () => {
    expect(verifySvixSignature(PAYLOAD, HEADERS, 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(false)
  })

  test('rejects missing headers', () => {
    expect(verifySvixSignature(PAYLOAD, { id: undefined, timestamp: HEADERS.timestamp, signature: HEADERS.signature }, SECRET)).toBe(false)
    expect(verifySvixSignature(PAYLOAD, { id: HEADERS.id, timestamp: undefined, signature: HEADERS.signature }, SECRET)).toBe(false)
    expect(verifySvixSignature(PAYLOAD, { id: HEADERS.id, timestamp: HEADERS.timestamp, signature: undefined }, SECRET)).toBe(false)
  })

  test('rejects a non-v1 signature', () => {
    expect(verifySvixSignature(PAYLOAD, { ...HEADERS, signature: 'v2,aaaa' }, SECRET)).toBe(false)
  })
})
