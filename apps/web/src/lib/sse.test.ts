import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readSSE } from './sse'

describe('readSSE', () => {
  test('waits for each event handler before delivering the next streamed frame', async () => {
    const response = new Response([
      'event: chunk\ndata: {"text":"Hel"}\n\n',
      'event: chunk\ndata: {"text":"lo"}\n\n',
      'event: done\ndata: {}\n\n',
    ].join(''))
    const seen: string[] = []

    await readSSE(response, {
      onEvent: async (event, data) => {
        seen.push(`${event}:start:${data}`)
        await Promise.resolve()
        seen.push(`${event}:end:${data}`)
      },
    })

    assert.deepEqual(seen, [
      'chunk:start:{"text":"Hel"}',
      'chunk:end:{"text":"Hel"}',
      'chunk:start:{"text":"lo"}',
      'chunk:end:{"text":"lo"}',
      'done:start:{}',
      'done:end:{}',
    ])
  })
})
