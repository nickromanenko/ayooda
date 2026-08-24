import { describe, expect, test } from 'bun:test'
import { getExpectedTwilioSignature } from 'twilio'
import { formParams, verifyTwilioSignature } from './signature'

describe('Twilio webhook signatures', () => {
  const authToken = '12345'
  const url = 'https://api.ayooda.live/sms/webhook/channel-1'
  const params = { MessageSid: `SM${'a'.repeat(32)}`, From: '+14155552671', To: '+442079460123', Body: 'Hello' }

  test('accepts the official SDK signature for the exact URL and parameters', () => {
    const signature = getExpectedTwilioSignature(authToken, url, params)
    expect(verifyTwilioSignature(authToken, signature, url, params)).toBe(true)
    expect(verifyTwilioSignature(authToken, signature, `${url}/`, params)).toBe(false)
    expect(verifyTwilioSignature(authToken, signature, url, { ...params, Body: 'Changed' })).toBe(false)
  })

  test('parses Twilio form bodies without treating plus signs as spaces', () => {
    expect(formParams('From=%2B14155552671&Body=Hello+there')).toEqual({ From: '+14155552671', Body: 'Hello there' })
  })
})
