import { describe, expect, test } from 'bun:test'
import { signTicketWebhook, ticketPayloadHash } from './delivery'

describe('ticket delivery integrity', () => {
  test('signs the exact timestamp and raw body with HMAC SHA-256', () => {
    expect(signTicketWebhook(1_700_000_000, '{"hello":"world"}', 'secret')).toBe(
      '654f06c856baf080af3fa272934823257a542d35cf1f88099338f850a60601a4',
    )
  })

  test('changes the payload hash when ticket contents change', () => {
    const first = ticketPayloadHash({ id: 'evt_1', data: { subject: 'First' } })
    const second = ticketPayloadHash({ id: 'evt_1', data: { subject: 'Second' } })
    expect(first).toHaveLength(64)
    expect(first).not.toBe(second)
  })
})
