import { describe, expect, test } from 'bun:test'
import { customEndpointStatus, normalizeCustomBaseURL, parseCustomEndpointBody, testCustomEndpoint } from './custom-endpoint'

describe('custom endpoint input', () => {
  test('normalizes a public-looking HTTPS prefix and removes one trailing slash', () => {
    expect(normalizeCustomBaseURL(' https://models.example.com/v1/ ')).toBe('https://models.example.com/v1')
  })

  test('rejects unsafe URL syntax and malformed model ids', () => {
    expect(parseCustomEndpointBody({ baseURL: 'http://localhost:1234/v1', modelId: 'llama' }).ok).toBe(false)
    expect(parseCustomEndpointBody({ baseURL: 'https://user:pass@example.com/v1', modelId: 'llama' }).ok).toBe(false)
    expect(parseCustomEndpointBody({ baseURL: 'https://example.com/v1?token=x', modelId: 'llama' }).ok).toBe(false)
    expect(parseCustomEndpointBody({ baseURL: 'https://example.com/v1', modelId: 'bad model' }).ok).toBe(false)
  })

  test('distinguishes key replacement, preservation, and explicit keyless mode', () => {
    expect(parseCustomEndpointBody({ baseURL: 'https://example.com/v1', modelId: 'meta/llama', apiKey: ' key ' }))
      .toEqual({ ok: true, value: { baseURL: 'https://example.com/v1', modelId: 'meta/llama', apiKey: 'key' } })
    expect(parseCustomEndpointBody({ baseURL: 'https://example.com/v1', modelId: 'meta/llama' }))
      .toEqual({ ok: true, value: { baseURL: 'https://example.com/v1', modelId: 'meta/llama', apiKey: undefined } })
    expect(parseCustomEndpointBody({ baseURL: 'https://example.com/v1', modelId: 'meta/llama', apiKey: null }))
      .toEqual({ ok: true, value: { baseURL: 'https://example.com/v1', modelId: 'meta/llama', apiKey: null } })
  })

  test('returns masked status only', () => {
    expect(customEndpointStatus({ baseURL: 'https://example.com/v1', modelId: 'llama', apiKeyEnc: 'ciphertext' })).toEqual({
      configured: true, baseURL: 'https://example.com/v1', modelId: 'llama', hasApiKey: true,
    })
    expect(customEndpointStatus(null).configured).toBe(false)
  })
})

describe('custom endpoint verification', () => {
  const safe = async (url: string) => new URL(url)

  test('accepts a model returned by the standard model list and sends bearer auth', async () => {
    let authorization = ''
    const result = await testCustomEndpoint(
      { baseURL: 'https://example.com/v1', modelId: 'llama', apiKey: 'secret' },
      {
        assertSafe: safe,
        fetch: (async (_input, init) => {
          authorization = String((init?.headers as Record<string, string>).Authorization)
          return Response.json({ object: 'list', data: [{ id: 'llama', object: 'model' }] })
        }) as typeof fetch,
      },
    )
    expect(result).toEqual({ ok: true })
    expect(authorization).toBe('Bearer secret')
  })

  test('rejects missing models, authentication failures, and private DNS', async () => {
    expect(await testCustomEndpoint(
      { baseURL: 'https://example.com/v1', modelId: 'missing' },
      { assertSafe: safe, fetch: (async () => Response.json({ data: [{ id: 'other' }] })) as unknown as typeof fetch },
    )).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringContaining('was not returned') })
    expect(await testCustomEndpoint(
      { baseURL: 'https://example.com/v1', modelId: 'm' },
      { assertSafe: safe, fetch: (async () => new Response('', { status: 401 })) as unknown as typeof fetch },
    )).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await testCustomEndpoint(
      { baseURL: 'https://internal.example/v1', modelId: 'm' },
      { assertSafe: async () => { throw new Error('blocked host') } },
    )).toMatchObject({ ok: false, reason: 'invalid', error: expect.stringContaining('public') })
  })
})
