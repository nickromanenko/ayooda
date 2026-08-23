import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_MODELS_URL,
  MODEL_CATALOG_TTL_MS,
  createModelCatalogLoader,
  isGatewayModelId,
  normalizeGatewayModels,
  validateGatewayModelSelection,
} from './model-catalog'

const payload = {
  data: [
    {
      id: 'meta/llama-3.3-70b-instruct', type: 'language', name: 'Llama 3.3 70B',
      description: 'A Meta language model.', context_window: 131072, max_tokens: 8192,
      pricing: { input: '0.0000002', output: '0.0000004' },
    },
    { id: 'openai/text-embedding-3-small', type: 'embedding', name: 'Embedding' },
    { id: 'black-forest-labs/flux', type: 'image', name: 'Image' },
    { id: '../bad model', type: 'language', name: 'Bad' },
  ],
}

describe('Gateway model catalog normalization', () => {
  test('keeps language models, filters other types, and merges recommended defaults', () => {
    const models = normalizeGatewayModels(payload)
    const llama = models.find((model) => model.id === 'meta/llama-3.3-70b-instruct')
    expect(llama).toEqual({
      id: 'meta/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B',
      description: 'A Meta language model.',
      provider: 'meta',
      pricing: { input: '0.0000002', output: '0.0000004' },
      contextWindow: 131072,
      maxOutputTokens: 8192,
      recommended: false,
    })
    expect(models.some((model) => model.id === 'openai/text-embedding-3-small')).toBe(false)
    expect(models.some((model) => model.id === 'black-forest-labs/flux')).toBe(false)
    expect(models.some((model) => model.recommended)).toBe(true)
  })

  test('rejects malformed top-level responses', () => {
    expect(() => normalizeGatewayModels(null)).toThrow()
    expect(() => normalizeGatewayModels({ data: 'nope' })).toThrow()
  })

  test('accepts safe creator/model ids only', () => {
    expect(isGatewayModelId('meta/llama-3.3-70b-instruct')).toBe(true)
    expect(isGatewayModelId('openai/gpt-5:latest')).toBe(true)
    expect(isGatewayModelId('no-slash')).toBe(false)
    expect(isGatewayModelId('../bad model')).toBe(false)
    expect(isGatewayModelId('a/'.padEnd(202, 'x'))).toBe(false)
  })
})

describe('Gateway model catalog cache', () => {
  test('deduplicates concurrent requests and refreshes after five minutes', async () => {
    let calls = 0
    let now = 1_000
    const load = createModelCatalogLoader(async (url, init) => {
      calls++
      expect(url).toBe(GATEWAY_MODELS_URL)
      expect(init.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify(payload), { status: 200 })
    }, () => now)

    const [first, second] = await Promise.all([load(), load()])
    expect(first).toBe(second)
    expect(calls).toBe(1)
    await load()
    expect(calls).toBe(1)
    now += MODEL_CATALOG_TTL_MS + 1
    await load()
    expect(calls).toBe(2)
  })

  test('does not cache a failed request', async () => {
    let calls = 0
    const load = createModelCatalogLoader(async () => {
      calls++
      return calls === 1
        ? new Response('down', { status: 503 })
        : new Response(JSON.stringify(payload), { status: 200 })
    })
    await expect(load()).rejects.toThrow()
    await expect(load()).resolves.toBeDefined()
    expect(calls).toBe(2)
  })
})

describe('Gateway model selection validation', () => {
  test('always permits recommended defaults', async () => {
    expect(await validateGatewayModelSelection('google/gemini-2.5-flash', async () => {
      throw new Error('should not fetch')
    })).toEqual({ ok: true })
  })

  test('permits discovered dynamic models and rejects unknown ones', async () => {
    const load = async () => ({ models: normalizeGatewayModels(payload), dynamic: true, fetchedAt: new Date().toISOString() })
    expect(await validateGatewayModelSelection('meta/llama-3.3-70b-instruct', load)).toEqual({ ok: true })
    expect(await validateGatewayModelSelection('meta/not-real', load)).toEqual({
      ok: false, reason: 'invalid', error: 'That model is not available through AI Gateway.',
    })
  })

  test('distinguishes catalog failure from an invalid selection', async () => {
    expect(await validateGatewayModelSelection('meta/llama-3.3-70b-instruct', async () => {
      throw new Error('gateway down')
    })).toEqual({
      ok: false,
      reason: 'unavailable',
      error: 'Could not verify this model with AI Gateway. Please try again.',
    })
  })
})
