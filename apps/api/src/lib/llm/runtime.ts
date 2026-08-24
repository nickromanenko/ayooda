import { createGateway, type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { assertSafeHttpsUrl } from '../tools/ssrf'

export type LlmRuntime =
  | { type: 'gateway'; apiKey: string }
  | { type: 'openai-compatible'; baseURL: string; apiKey?: string }

export const CUSTOM_MODEL_REQUEST_TIMEOUT_MS = 60_000

export function assertCustomRuntimeUrl(baseURL: string, requestUrl: string): URL {
  const base = new URL(baseURL)
  const request = new URL(requestUrl)
  const basePath = base.pathname.replace(/\/$/, '')
  if (request.origin !== base.origin || (request.pathname !== basePath && !request.pathname.startsWith(`${basePath}/`))) {
    throw new Error('custom endpoint request escaped its configured base URL')
  }
  return request
}

export function guardedCustomFetch(baseURL: string, fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = input instanceof Request ? input.url : String(input)
    const url = assertCustomRuntimeUrl(baseURL, requestUrl)
    await assertSafeHttpsUrl(url.toString())
    return fetchImpl(input, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(CUSTOM_MODEL_REQUEST_TIMEOUT_MS),
    })
  }) as typeof fetch
}

export function createRuntimeLanguageModel(runtime: LlmRuntime, modelId: string): LanguageModel {
  if (runtime.type === 'gateway') return createGateway({ apiKey: runtime.apiKey })(modelId)
  return createOpenAICompatible({
    name: 'custom-endpoint',
    baseURL: runtime.baseURL,
    ...(runtime.apiKey ? { apiKey: runtime.apiKey } : {}),
    includeUsage: true,
    fetch: guardedCustomFetch(runtime.baseURL),
  })(modelId)
}
