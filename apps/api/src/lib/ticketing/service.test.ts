import { describe, expect, test } from 'bun:test'
import { boundedTicketTranscript } from './service'

describe('ticket transcript bounds', () => {
  test('keeps the newest messages within the serialized byte limit', () => {
    const messages = [
      { role: 'user', content: 'old'.repeat(20), createdAt: null },
      { role: 'assistant', content: 'middle'.repeat(20), createdAt: null },
      { role: 'user', content: 'new', createdAt: null },
    ]
    const result = boundedTicketTranscript(messages, 180)
    expect(result.at(-1)?.content).toBe('new')
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(180)
    expect(result).not.toContainEqual(messages[0])
  })
})
