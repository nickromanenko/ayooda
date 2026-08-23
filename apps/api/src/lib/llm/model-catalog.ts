import { LLM_MODELS, type GatewayModelCatalog, type GatewayModelInfo } from '@ayooda/shared'

export const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
export const MODEL_CATALOG_TTL_MS = 5 * 60_000
export const MODEL_CATALOG_TIMEOUT_MS = 10_000
export const MODEL_ID_MAX_LENGTH = 200

const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/

export function isGatewayModelId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MODEL_ID_MAX_LENGTH
    && MODEL_ID_RE.test(value)
}

function safeString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function safePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function safePrice(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? value : null
}

function recommendedInfo(): GatewayModelInfo[] {
  return LLM_MODELS.map((model) => ({
    id: model.id,
    name: model.label,
    description: model.description,
    provider: model.id.split('/')[0]!,
    pricing: null,
    contextWindow: null,
    maxOutputTokens: null,
    recommended: true,
  }))
}

export function recommendedGatewayModels(): GatewayModelInfo[] {
  return recommendedInfo()
}

/** Normalize the public OpenAI-style Gateway catalog and keep language models only. */
export function normalizeGatewayModels(payload: unknown): GatewayModelInfo[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('Invalid AI Gateway model catalog response.')
  }

  const recommendedById = new Map(recommendedInfo().map((model) => [model.id, model]))
  const normalized = new Map<string, GatewayModelInfo>()

  for (const item of (payload as { data: unknown[] }).data) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (raw.type !== 'language' || !isGatewayModelId(raw.id)) continue

    const id = raw.id
    const recommended = recommendedById.get(id)
    const pricing = raw.pricing && typeof raw.pricing === 'object'
      ? raw.pricing as Record<string, unknown>
      : null
    const input = pricing ? safePrice(pricing.input) : null
    const output = pricing ? safePrice(pricing.output) : null

    normalized.set(id, {
      id,
      name: safeString(raw.name, 160) ?? recommended?.name ?? id,
      description: safeString(raw.description, 500) ?? recommended?.description ?? '',
      provider: id.split('/')[0]!,
      pricing: input !== null && output !== null ? { input, output } : null,
      contextWindow: safePositiveInt(raw.context_window),
      maxOutputTokens: safePositiveInt(raw.max_tokens),
      recommended: !!recommended,
    })
  }

  // Defaults remain selectable if the live catalog temporarily omits a legacy alias.
  for (const model of recommendedById.values()) {
    if (!normalized.has(model.id)) normalized.set(model.id, model)
  }

  const recommendedOrder = new Map(LLM_MODELS.map((model, index) => [model.id, index]))
  return [...normalized.values()].sort((a, b) => {
    const aOrder = recommendedOrder.get(a.id)
    const bOrder = recommendedOrder.get(b.id)
    if (aOrder !== undefined || bOrder !== undefined) {
      if (aOrder === undefined) return 1
      if (bOrder === undefined) return -1
      return aOrder - bOrder
    }
    return a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
  })
}

type CatalogFetch = (input: string, init: RequestInit) => Promise<Response>

export function createModelCatalogLoader(
  fetchImpl: CatalogFetch = fetch,
  now: () => number = Date.now,
): () => Promise<GatewayModelCatalog> {
  let cached: GatewayModelCatalog | null = null
  let expiresAt = 0
  let pending: Promise<GatewayModelCatalog> | null = null

  return async () => {
    const current = now()
    if (cached && current < expiresAt) return cached
    if (pending) return pending

    pending = (async () => {
      const response = await fetchImpl(GATEWAY_MODELS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`AI Gateway model catalog returned ${response.status}.`)
      const models = normalizeGatewayModels(await response.json())
      const catalog: GatewayModelCatalog = {
        models,
        dynamic: true,
        fetchedAt: new Date(now()).toISOString(),
      }
      cached = catalog
      expiresAt = now() + MODEL_CATALOG_TTL_MS
      return catalog
    })().finally(() => { pending = null })

    return pending
  }
}

export const loadGatewayModelCatalog = createModelCatalogLoader()

export type ModelSelectionResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unavailable'; error: string }

export async function validateGatewayModelSelection(
  modelId: unknown,
  loadCatalog: () => Promise<GatewayModelCatalog> = loadGatewayModelCatalog,
): Promise<ModelSelectionResult> {
  if (!isGatewayModelId(modelId)) {
    return { ok: false, reason: 'invalid', error: 'Invalid AI Gateway model id.' }
  }
  if (LLM_MODELS.some((model) => model.id === modelId)) return { ok: true }

  try {
    const catalog = await loadCatalog()
    return catalog.models.some((model) => model.id === modelId)
      ? { ok: true }
      : { ok: false, reason: 'invalid', error: 'That model is not available through AI Gateway.' }
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      error: 'Could not verify this model with AI Gateway. Please try again.',
    }
  }
}
