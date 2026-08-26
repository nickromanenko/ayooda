import { describe, expect, test } from 'bun:test'
import { MessageBuffer, type FeedMessage } from './message-buffer'

const reply: FeedMessage = { id: 'assistant-1', role: 'assistant', content: 'Hello' }

describe('MessageBuffer', () => {
  test('drops a live event when the POST stream rendered the same message first', () => {
    const buffer = new MessageBuffer()

    expect(buffer.accept(reply, true)).toEqual([])
    buffer.markRendered(reply.id)
    expect(buffer.flush()).toEqual([])
  })

  test('retains unrelated messages received during a POST stream', () => {
    const buffer = new MessageBuffer()
    const teammate = { id: 'teammate-1', role: 'human', content: 'I can help' }

    buffer.accept(reply, true)
    buffer.accept(teammate, true)
    buffer.markRendered(reply.id)

    expect(buffer.flush()).toEqual([teammate])
  })

  test('ignores repeated live events', () => {
    const buffer = new MessageBuffer()

    expect(buffer.accept(reply, false)).toEqual([reply])
    expect(buffer.accept(reply, false)).toEqual([])
  })
})
