import { describe, expect, test, afterEach } from 'bun:test'
import { getMe, sendMessage } from './client'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function okResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('telegram client', () => {
  test('getMe returns the bot info and calls the right URL', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (url: string) => { calledUrl = url; return okResponse({ id: 1, username: 'my_bot', first_name: 'My' }) }) as unknown as typeof fetch
    const me = await getMe('TOK')
    expect(me).toEqual({ id: 1, username: 'my_bot', first_name: 'My' })
    expect(calledUrl).toBe('https://api.telegram.org/botTOK/getMe')
  })
  test('sendMessage posts chat_id + text', async () => {
    let body = ''
    globalThis.fetch = (async (_url: string, init: RequestInit) => { body = init.body as string; return okResponse({ message_id: 9 }) }) as unknown as typeof fetch
    await sendMessage('TOK', 42, 'hi there')
    const parsed = JSON.parse(body)
    expect(parsed).toEqual({ chat_id: 42, text: 'hi there' })
  })
  test('throws on a non-ok Telegram response', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })) as unknown as typeof fetch
    await expect(getMe('BAD')).rejects.toThrow('Unauthorized')
  })
})
