import { decryptSecret } from '../crypto'
import type { StoredCustomEndpoint } from './custom-endpoint'
import type { LlmRuntime } from './runtime'

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

export function resolveAgentRuntime(
  encryptedAgentKey: string | undefined,
  customEndpoint: StoredCustomEndpoint | undefined,
): { ok: true; runtime: LlmRuntime } | { ok: false; reason: 'missing_key' | 'invalid_config' } {
  if (customEndpoint?.baseURL && customEndpoint.modelId) {
    try {
      return {
        ok: true,
        runtime: {
          type: 'openai-compatible',
          baseURL: customEndpoint.baseURL,
          ...(customEndpoint.apiKeyEnc ? { apiKey: decryptSecret(customEndpoint.apiKeyEnc) } : {}),
        },
      }
    } catch {
      return { ok: false, reason: 'invalid_config' }
    }
  }
  const gateway = resolveGatewayKey(encryptedAgentKey)
  return gateway.ok
    ? { ok: true, runtime: { type: 'gateway', apiKey: gateway.apiKey } }
    : gateway
}
