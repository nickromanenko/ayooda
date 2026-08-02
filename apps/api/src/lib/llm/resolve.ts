import { decryptSecret } from '../crypto'

/**
 * Resolve the AI Gateway API key for a turn: the agent's own key if set, else the platform
 * AI_GATEWAY_API_KEY (which covers all providers). Returns not-ok if neither is available.
 */
export function resolveGatewayKey(
  encryptedAgentKey: string | undefined,
): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' } {
  if (encryptedAgentKey) {
    return { ok: true, apiKey: decryptSecret(encryptedAgentKey) }
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return { ok: true, apiKey: process.env.AI_GATEWAY_API_KEY }
  }
  return { ok: false, reason: 'missing_key' }
}
