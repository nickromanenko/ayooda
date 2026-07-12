import { describe, expect, test, afterEach } from 'bun:test'
import { streamChat } from './openrouter'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('streamChat', () => {
  test('forwards deltas in order, stops on [DONE], reports usage', async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":11,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n'
    globalThis.fetch = (async () => sseResponse(body)) as unknown as typeof fetch

    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
    const chunks: string[] = []
    let result
    while (true) {
      const next = await gen.next()
      if (next.done) { result = next.value; break }
      chunks.push(next.value.text)
    }
    expect(chunks).toEqual(['Hel', 'lo'])
    expect(result).toEqual({ promptTokens: 11, completionTokens: 2 })
  })

  test('throws on a non-2xx response', async () => {
    globalThis.fetch = (async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })) as unknown as typeof fetch
    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [], apiKey: 'k' })
    await expect(gen.next()).rejects.toThrow()
  })

  test('processes a usage frame delivered without a trailing blank line before done', async () => {
    // Body split so the usage frame arrives in the final chunk with no trailing \n\n
    const body =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":1}}'
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch
    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [], apiKey: 'k' })
    const texts: string[] = []
    let result
    while (true) { const n = await gen.next(); if (n.done) { result = n.value; break } texts.push(n.value.text) }
    expect(texts).toEqual(['Hi'])
    expect(result).toEqual({ promptTokens: 5, completionTokens: 1 })
  })

  test('throws on a mid-stream error event', async () => {
    const body = 'data: {"error":{"message":"rate limited"}}\n\n'
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch
    const gen = streamChat({ model: 'x/y', systemPrompt: 's', messages: [], apiKey: 'k' })
    await expect(gen.next()).rejects.toThrow('rate limited')
  })
})
