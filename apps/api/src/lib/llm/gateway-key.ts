import { createGateway } from 'ai'
import type { GatewayKeyStatus } from '@ayooda/shared'

export const GATEWAY_KEY_MAX_LENGTH = 4096
export const GATEWAY_KEY_TEST_TIMEOUT_MS = 10_000

export type GatewayKeyTestResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unavailable'; error: string }

export function gatewayKeyStatus(
  encryptedAgentKey: unknown,
  platformKey: string | undefined = process.env.AI_GATEWAY_API_KEY,
): GatewayKeyStatus {
  const hasAgentKey = typeof encryptedAgentKey === 'string' && encryptedAgentKey.length > 0
  const platformAvailable = !!platformKey
  return {
    hasAgentKey,
    platformAvailable,
    source: hasAgentKey ? 'agent' : platformAvailable ? 'platform' : 'none',
  }
}

export function parseGatewayKeyBody(body: unknown):
  | { ok: true; apiKey: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'apiKey is required.' }
  }
  const apiKey = (body as Record<string, unknown>).apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: 'apiKey is required.' }
  }
  const trimmed = apiKey.trim()
  if (trimmed.length > GATEWAY_KEY_MAX_LENGTH) {
    return { ok: false, error: `apiKey must be at most ${GATEWAY_KEY_MAX_LENGTH} characters.` }
  }
  return { ok: true, apiKey: trimmed }
}

type CreditsLookup = (apiKey: string) => Promise<unknown>

async function lookupCredits(apiKey: string): Promise<unknown> {
  const gateway = createGateway({
    apiKey,
    fetch: ((input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(GATEWAY_KEY_TEST_TIMEOUT_MS),
    })) as typeof fetch,
  })
  return gateway.getCredits()
}

/** Verify an AI Gateway key without generating content or spending tokens. */
export async function testGatewayKey(
  apiKey: string,
  creditsLookup: CreditsLookup = lookupCredits,
): Promise<GatewayKeyTestResult> {
  try {
    await creditsLookup(apiKey)
    return { ok: true }
  } catch (err) {
    const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err
      ? (err as { statusCode?: unknown }).statusCode
      : undefined
    if (statusCode === 401 || statusCode === 403) {
      return { ok: false, reason: 'invalid', error: 'AI Gateway rejected this key.' }
    }
    return {
      ok: false,
      reason: 'unavailable',
      error: 'Could not verify the key with AI Gateway. Please try again.',
    }
  }
}
