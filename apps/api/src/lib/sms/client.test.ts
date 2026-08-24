import { describe, expect, test } from 'bun:test'
import { assertTwilioNumber, sendSms, splitSmsMessage } from './client'

describe('Twilio SMS client', () => {
  test('verifies credentials and ownership of the configured number', async () => {
    const urls: string[] = []
    await assertTwilioNumber('ACaccount', 'token', '+14155552671', (async (url) => {
      urls.push(String(url))
      return urls.length === 1
        ? Response.json({ status: 'active' })
        : Response.json({ incoming_phone_numbers: [{ phone_number: '+14155552671', capabilities: { sms: true } }] })
    }) as typeof fetch)
    expect(urls[0]).toEndWith('/Accounts/ACaccount.json')
    expect(urls[1]).toContain('PhoneNumber=%2B14155552671')
  })

  test('rejects a number that is not owned by the account', async () => {
    await expect(assertTwilioNumber('ACaccount', 'token', '+14155552671', (async (url) => (
      String(url).endsWith('.json')
        ? Response.json({ status: 'active' })
        : Response.json({ incoming_phone_numbers: [] })
    )) as typeof fetch)).rejects.toThrow('does not belong')
  })

  test('rejects an owned voice-only number', async () => {
    let calls = 0
    await expect(assertTwilioNumber('ACaccount', 'token', '+14155552671', (async (_url, _init) => {
      calls++
      return calls === 1
        ? Response.json({ status: 'active' })
        : Response.json({ incoming_phone_numbers: [{ phone_number: '+14155552671', capabilities: { voice: true, sms: false } }] })
    }) as typeof fetch)).rejects.toThrow('not SMS capable')
  })

  test('chunks long replies and sends every chunk with the same route', async () => {
    const bodies: URLSearchParams[] = []
    const text = `${'a'.repeat(900)} ${'b'.repeat(900)}`
    await sendSms('ACaccount', 'token', '+14155552671', '+442079460123', text, (async (_url, init) => {
      bodies.push(new URLSearchParams(String(init?.body)))
      return Response.json({ sid: 'SMmessage' })
    }) as typeof fetch)
    expect(bodies).toHaveLength(2)
    expect(bodies.every((body) => body.get('From') === '+14155552671' && body.get('To') === '+442079460123')).toBe(true)
    expect(bodies.map((body) => body.get('Body')).join(' ')).toBe(text)
  })

  test('does not emit empty chunks and hard-splits unbroken text', () => {
    expect(splitSmsMessage('   ')).toEqual([])
    expect(splitSmsMessage('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})
