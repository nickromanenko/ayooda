import { describe, expect, test } from 'bun:test'
import { verifySlackSignature } from './signature'

describe('Slack request signatures', () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5'
  const timestamp = '1531420618'
  const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c'
  const signature = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503'

  test('accepts Slack’s published signing vector', () => {
    expect(verifySlackSignature(body, { timestamp, signature }, secret, Number(timestamp) * 1000)).toBe(true)
  })

  test('rejects changed bodies, bad signatures, and stale timestamps', () => {
    expect(verifySlackSignature(`${body}x`, { timestamp, signature }, secret, Number(timestamp) * 1000)).toBe(false)
    expect(verifySlackSignature(body, { timestamp, signature: 'v0=bad' }, secret, Number(timestamp) * 1000)).toBe(false)
    expect(verifySlackSignature(body, { timestamp, signature }, secret, (Number(timestamp) + 301) * 1000)).toBe(false)
  })
})
