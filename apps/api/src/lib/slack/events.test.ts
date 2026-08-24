import { describe, expect, test } from 'bun:test'
import { parseSlackEnvelope, slackConversationId, slackVisitorId, stripSlackMention } from './events'

describe('Slack event parsing', () => {
  test('returns a valid URL verification challenge', () => {
    expect(parseSlackEnvelope({ type: 'url_verification', challenge: 'abc' }, 'U_BOT'))
      .toEqual({ kind: 'challenge', challenge: 'abc' })
  })

  test('parses an app mention, removes the bot mention, and starts a thread', () => {
    expect(parseSlackEnvelope({
      type: 'event_callback', event_id: 'Ev123', team_id: 'T123',
      event: { type: 'app_mention', user: 'U123', channel: 'C123', ts: '123.456', text: '<@UBOT>   Need help' },
    }, 'UBOT')).toEqual({
      kind: 'message', eventId: 'Ev123', teamId: 'T123', channelId: 'C123', userId: 'U123',
      text: 'Need help', messageTs: '123.456', threadTs: '123.456', direct: false,
    })
  })

  test('accepts direct messages but ignores ordinary channel messages and bot echoes', () => {
    const base = { type: 'event_callback', event_id: 'Ev1', team_id: 'T1' }
    expect(parseSlackEnvelope({ ...base, event: { type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', ts: '1.2', text: 'hello' } }, 'UB'))
      .toMatchObject({ kind: 'message', direct: true, text: 'hello' })
    expect(parseSlackEnvelope({ ...base, event: { type: 'message', channel_type: 'channel', user: 'U1', channel: 'C1', ts: '1.2', text: 'hello' } }, 'UB'))
      .toEqual({ kind: 'ignore' })
    expect(parseSlackEnvelope({ ...base, event: { type: 'message', channel_type: 'im', bot_id: 'B1', channel: 'D1', ts: '1.2', text: 'echo' } }, 'UB'))
      .toEqual({ kind: 'ignore' })
  })

  test('builds stable direct-message and thread identities', () => {
    expect(slackConversationId('T1', 'D1', undefined, true)).toBe('sl_T1_D1')
    expect(slackConversationId('T1', 'C1', '123.456', false)).toBe('sl_T1_C1_123_456')
    expect(slackVisitorId('T1', 'U1')).toBe('sl_T1_U1')
    expect(stripSlackMention('<@UB> hi <@UB>', 'UB')).toBe('hi')
  })
})
