import type { LLMProvider } from '@ayooda/shared'
import { decryptSecret } from '../crypto'

export function resolveOpenRouterKey(
  provider: LLMProvider,
  encryptedWorkspaceKey: string | undefined,
): { ok: true; apiKey: string } | { ok: false; reason: 'missing_key' } {
  if (encryptedWorkspaceKey) {
    return { ok: true, apiKey: decryptSecret(encryptedWorkspaceKey) }
  }
  if (provider === 'gemini' && process.env.OPENROUTER_API_KEY) {
    return { ok: true, apiKey: process.env.OPENROUTER_API_KEY }
  }
  return { ok: false, reason: 'missing_key' }
}
