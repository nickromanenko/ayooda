import { describe, expect, test } from 'bun:test'
import { extractSSEMessages } from './sse'

describe('extractSSEMessages', () => {
  test('parses complete event frames and returns the incomplete tail', () => {
    const buf =
      'event: chunk\ndata: {"text":"Hel"}\n\nevent: chunk\ndata: {"text":"lo"}\n\nevent: do'
    const { messages, rest } = extractSSEMessages(buf)
    expect(messages).toEqual([
      { event: 'chunk', data: '{"text":"Hel"}' },
      { event: 'chunk', data: '{"text":"lo"}' },
    ])
    expect(rest).toBe('event: do')
  })
  test('defaults event name to "message"', () => {
    const { messages } = extractSSEMessages('data: hi\n\n')
    expect(messages).toEqual([{ event: 'message', data: 'hi' }])
  })
  test('joins multi-line data with newlines', () => {
    const { messages } = extractSSEMessages('event: x\ndata: a\ndata: b\n\n')
    expect(messages[0].data).toBe('a\nb')
  })
  test('handles CRLF line endings', () => {
    const { messages, rest } = extractSSEMessages('event: chunk\r\ndata: {"a":1}\r\n\r\n')
    expect(messages).toEqual([{ event: 'chunk', data: '{"a":1}' }])
    expect(rest).toBe('')
  })
  test('empty buffer yields nothing', () => {
    expect(extractSSEMessages('')).toEqual({ messages: [], rest: '' })
  })
})
