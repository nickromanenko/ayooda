import type { CustomEndpointStatus } from '@ayooda/shared'
import { assertSafeHttpsUrl } from '../tools/ssrf'

export const CUSTOM_ENDPOINT_URL_MAX_LENGTH = 2_048
export const CUSTOM_ENDPOINT_MODEL_MAX_LENGTH = 200
export const CUSTOM_ENDPOINT_KEY_MAX_LENGTH = 4_096
export const CUSTOM_ENDPOINT_TEST_TIMEOUT_MS = 10_000
const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/

export interface StoredCustomEndpoint {
  baseURL: string
  modelId: string
  apiKeyEnc?: string
}

export type ParsedCustomEndpoint = {
  baseURL: string
  modelId: string
  /** undefined preserves a saved key, null explicitly configures a keyless endpoint. */
  apiKey: string | null | undefined
}

export function normalizeCustomBaseURL(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > CUSTOM_ENDPOINT_URL_MAX_LENGTH) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function parseCustomEndpointBody(body: unknown): { ok: true; value: ParsedCustomEndpoint } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Endpoint settings are required.' }
  const raw = body as Record<string, unknown>
  const baseURL = normalizeCustomBaseURL(raw.baseURL)
  if (!baseURL) return { ok: false, error: 'Base URL must be a public HTTPS URL without credentials, query parameters, or a fragment.' }
  const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : ''
  if (!modelId || modelId.length > CUSTOM_ENDPOINT_MODEL_MAX_LENGTH || !MODEL_ID_RE.test(modelId)) {
    return { ok: false, error: 'Model ID must use letters, numbers, dots, dashes, underscores, slashes, or colons.' }
  }
  let apiKey: string | null | undefined
  if (raw.apiKey === null) apiKey = null
  else if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== 'string' || !raw.apiKey.trim()) return { ok: false, error: 'API key cannot be blank; choose keyless explicitly.' }
    apiKey = raw.apiKey.trim()
    if (apiKey.length > CUSTOM_ENDPOINT_KEY_MAX_LENGTH) return { ok: false, error: `API key must be at most ${CUSTOM_ENDPOINT_KEY_MAX_LENGTH} characters.` }
  }
  return { ok: true, value: { baseURL, modelId, apiKey } }
}

export function customEndpointStatus(value: unknown): CustomEndpointStatus {
  if (!value || typeof value !== 'object') return { configured: false, baseURL: null, modelId: null, hasApiKey: false }
  const data = value as Record<string, unknown>
  const baseURL = normalizeCustomBaseURL(data.baseURL)
  const modelId = typeof data.modelId === 'string' && MODEL_ID_RE.test(data.modelId) ? data.modelId : null
  return {
    configured: !!baseURL && !!modelId,
    baseURL,
    modelId,
    hasApiKey: typeof data.apiKeyEnc === 'string' && data.apiKeyEnc.length > 0,
  }
}

type VerifyDeps = {
  assertSafe?: (url: string) => Promise<URL>
  fetch?: typeof fetch
}

export type CustomEndpointTestResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unavailable'; error: string }

async function readCappedJson(response: Response, maxBytes = 256 * 1024): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large')
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('response too large')
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(merged))
}

/** Verify standard model discovery without generating content or spending model tokens. */
export async function testCustomEndpoint(
  config: { baseURL: string; modelId: string; apiKey?: string },
  deps: VerifyDeps = {},
): Promise<CustomEndpointTestResult> {
  const modelsUrl = `${config.baseURL}/models`
  try {
    await (deps.assertSafe ?? assertSafeHttpsUrl)(modelsUrl)
    const response = await (deps.fetch ?? fetch)(modelsUrl, {
      headers: { Accept: 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(CUSTOM_ENDPOINT_TEST_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'invalid', error: 'The endpoint rejected this API key.' }
    }
    if (!response.ok) return { ok: false, reason: 'unavailable', error: `The endpoint's model list returned ${response.status}.` }
    const payload = await readCappedJson(response)
    const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined
    if (!Array.isArray(data)) return { ok: false, reason: 'invalid', error: 'The endpoint did not return an OpenAI-compatible model list.' }
    const found = data.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === config.modelId)
    return found
      ? { ok: true }
      : { ok: false, reason: 'invalid', error: `Model "${config.modelId}" was not returned by this endpoint.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'blocked host' || message === 'only https is allowed' || message === 'invalid url') {
      return { ok: false, reason: 'invalid', error: 'The endpoint must resolve only to public addresses.' }
    }
    return { ok: false, reason: 'unavailable', error: 'Could not verify this endpoint. Check its URL, TLS certificate, and availability.' }
  }
}
