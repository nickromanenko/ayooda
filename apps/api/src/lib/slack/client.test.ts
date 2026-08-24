import { describe, expect, test } from 'bun:test'
import { authTest, sendSlackMessage, splitSlackMessage } from './client'

describe('Slack Web API client', () => {
  test('verifies a bot token and maps its workspace identity', async () => {
    let authorization = ''
    const identity = await authTest('xoxb-token', (async (_url, init) => {
      authorization = String((init?.headers as Record<string, string>).Authorization)
      return Response.json({ ok: true, team_id: 'T1', team: 'Acme', user_id: 'UBOT' })
    }) as typeof fetch)
    expect(identity).toEqual({ teamId: 'T1', teamName: 'Acme', botUserId: 'UBOT' })
    expect(authorization).toBe('Bearer xoxb-token')
  })

  test('chunks long messages and keeps every chunk in the requested thread', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const text = `${'a'.repeat(2500)} ${'b'.repeat(2500)}`
    await sendSlackMessage('token', 'C1', text, '123.456', (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({ ok: true, ts: '1.2' })
    }) as typeof fetch)
    expect(bodies).toHaveLength(2)
    expect(bodies.every((body) => body.channel === 'C1' && body.thread_ts === '123.456')).toBe(true)
    expect(bodies.map((body) => body.text).join(' ')).toBe(text)
  })

  test('does not emit empty chunks', () => {
    expect(splitSlackMessage('   ')).toEqual([])
  })

  test('hard-splits a long unbroken token at the configured limit', () => {
    const chunks = splitSlackMessage('x'.repeat(10), 4)
    expect(chunks).toEqual(['xxxx', 'xxxx', 'xx'])
  })
})
