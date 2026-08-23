import { createHmac, timingSafeEqual } from 'crypto'

export interface SvixHeaders {
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
}

/**
 * Verify a Svix v1 webhook signature (Resend signs its webhooks with Svix).
 * The signing secret is base64 (optionally prefixed `whsec_`); the signature is
 * HMAC-SHA256 over `id.timestamp.payload`, base64-encoded. Constant-time compare.
 */
export function verifySvixSignature(payload: string, headers: SvixHeaders, secret: string): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  if (!signature.startsWith('v1,')) return false

  const provided = signature.slice(3)
  const key = secret.startsWith('whsec_') ? secret.slice(6) : secret

  let keyBytes: Buffer
  let sigBytes: Buffer
  try {
    keyBytes = Buffer.from(key, 'base64')
    sigBytes = Buffer.from(provided, 'base64')
  } catch {
    return false
  }
  if (keyBytes.length === 0 || sigBytes.length === 0) return false

  const expected = createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${payload}`).digest()
  if (expected.length !== sigBytes.length) return false
  return timingSafeEqual(expected, sigBytes)
}
