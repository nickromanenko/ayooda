import { describe, expect, test } from 'bun:test'
import { parseUpdate } from './update'

describe('parseUpdate', () => {
  test('text message', () => {
    expect(parseUpdate({ message: { chat: { id: 42 }, from: { id: 7 }, text: 'hello' } }))
      .toEqual({ kind: 'text', chatId: 42, userId: 7, text: 'hello' })
  })
  test('message without text → nontext', () => {
    expect(parseUpdate({ message: { chat: { id: 42 }, from: { id: 7 }, photo: [{}] } }))
      .toEqual({ kind: 'nontext', chatId: 42, userId: 7 })
  })
  test('empty/whitespace text → nontext', () => {
    expect(parseUpdate({ message: { chat: { id: 1 }, from: { id: 2 }, text: '   ' } }))
      .toEqual({ kind: 'nontext', chatId: 1, userId: 2 })
  })
  test('edited_message → ignore', () => {
    expect(parseUpdate({ edited_message: { chat: { id: 1 }, from: { id: 2 }, text: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('channel_post → ignore', () => {
    expect(parseUpdate({ channel_post: { chat: { id: 1 }, text: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('callback_query → ignore', () => {
    expect(parseUpdate({ callback_query: { id: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('missing message → ignore', () => {
    expect(parseUpdate({})).toEqual({ kind: 'ignore' })
    expect(parseUpdate(null)).toEqual({ kind: 'ignore' })
  })
  test('message missing chat/from → ignore', () => {
    expect(parseUpdate({ message: { text: 'x' } })).toEqual({ kind: 'ignore' })
  })
  test('non-private chat (group) → ignore', () => {
    expect(parseUpdate({ message: { chat: { id: 1, type: 'group' }, from: { id: 2 }, text: 'hi' } })).toEqual({ kind: 'ignore' })
  })
  test('explicit private chat → text', () => {
    expect(parseUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 2 }, text: 'hi' } })).toEqual({ kind: 'text', chatId: 1, userId: 2, text: 'hi' })
  })
})
