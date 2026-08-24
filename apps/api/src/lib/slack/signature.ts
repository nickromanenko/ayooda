import { createHmac, timingSafeEqual } from 'crypto'

export interface SlackSignatureHeaders {
  timestamp: string | undefined
  signature: string | undefined
}

export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 5 * 60

/** Verify Slack's v0 HMAC over the untouched request body and reject replayed timestamps. */
export function verifySlackSignature(
  payload: string,
  headers: SlackSignatureHeaders,
  signingSecret: string,
  nowMs = Date.now(),
): boolean {
  const { timestamp, signature } = headers
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !signature.startsWith('v0=')) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isSafeInteger(timestampSeconds)) return false
  if (Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) > SLACK_SIGNATURE_MAX_AGE_SECONDS) return false

  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${payload}`)
    .digest('hex')}`
  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(signature)
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}
