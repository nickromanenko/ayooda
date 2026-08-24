import { describe, expect, test } from 'bun:test'
import { isTwilioAccountSid, normalizePhoneNumber, parseInboundSms, smsConversationId, smsVisitorId } from './message'

describe('SMS message parsing', () => {
  test('normalizes common phone formatting to E.164', () => {
    expect(normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671')
    expect(normalizePhoneNumber('4155552671')).toBeNull()
  })

  test('accepts valid Twilio text messages and rejects media-only or invalid requests', () => {
    const valid = {
      MessageSid: `SM${'a'.repeat(32)}`,
      From: '+14155552671',
      To: '+442079460123',
      Body: '  Need help  ',
    }
    expect(parseInboundSms(valid)).toEqual({ messageSid: valid.MessageSid, from: valid.From, to: valid.To, body: 'Need help' })
    expect(parseInboundSms({ ...valid, Body: '' })).toBeNull()
    expect(parseInboundSms({ ...valid, MessageSid: 'bad' })).toBeNull()
  })

  test('validates account SIDs and derives stable, opaque identities', () => {
    expect(isTwilioAccountSid(`AC${'1'.repeat(32)}`)).toBe(true)
    expect(isTwilioAccountSid(`SK${'1'.repeat(32)}`)).toBe(false)
    expect(smsConversationId('+14155552671', '+442079460123')).toBe(smsConversationId('+14155552671', '+442079460123'))
    expect(smsConversationId('+14155552671', '+442079460123')).not.toBe(smsConversationId('+14155552672', '+442079460123'))
    expect(smsVisitorId('+14155552671')).toStartWith('smsv_')
  })
})
