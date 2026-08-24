export type ParsedSlackEnvelope =
  | { kind: 'challenge'; challenge: string }
  | {
      kind: 'message'
      eventId: string
      teamId: string
      channelId: string
      userId: string
      text: string
      messageTs: string
      threadTs?: string
      direct: boolean
    }
  | { kind: 'ignore' }

interface SlackEnvelope {
  type?: string
  challenge?: string
  event_id?: string
  team_id?: string
  event?: {
    type?: string
    subtype?: string
    bot_id?: string
    bot_profile?: unknown
    user?: string
    text?: string
    ts?: string
    thread_ts?: string
    channel?: string
    channel_type?: string
  }
}

const SLACK_ID_RE = /^[A-Z0-9]+$/i
const SLACK_TS_RE = /^\d+\.\d+$/

export function stripSlackMention(text: string, botUserId: string): string {
  return text.replaceAll(`<@${botUserId}>`, ' ').replace(/\s+/g, ' ').trim()
}

export function parseSlackEnvelope(input: unknown, botUserId: string): ParsedSlackEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'ignore' }
  const envelope = input as SlackEnvelope
  if (envelope.type === 'url_verification') {
    return typeof envelope.challenge === 'string' && envelope.challenge.length <= 512
      ? { kind: 'challenge', challenge: envelope.challenge }
      : { kind: 'ignore' }
  }
  if (envelope.type !== 'event_callback' || !envelope.event_id || !envelope.team_id) return { kind: 'ignore' }
  if (!SLACK_ID_RE.test(envelope.event_id) || !SLACK_ID_RE.test(envelope.team_id)) return { kind: 'ignore' }

  const event = envelope.event
  if (!event || (event.type !== 'app_mention' && event.type !== 'message')) return { kind: 'ignore' }
  if (event.subtype || event.bot_id || event.bot_profile) return { kind: 'ignore' }
  if (!event.user || !event.channel || !event.ts || typeof event.text !== 'string') return { kind: 'ignore' }
  if (!SLACK_ID_RE.test(event.user) || !SLACK_ID_RE.test(event.channel) || !SLACK_TS_RE.test(event.ts)) return { kind: 'ignore' }
  if (event.thread_ts && !SLACK_TS_RE.test(event.thread_ts)) return { kind: 'ignore' }

  const direct = event.type === 'message' && event.channel_type === 'im'
  if (event.type === 'message' && !direct) return { kind: 'ignore' }
  const text = event.type === 'app_mention' ? stripSlackMention(event.text, botUserId) : event.text.trim()
  if (!text) return { kind: 'ignore' }

  return {
    kind: 'message',
    eventId: envelope.event_id,
    teamId: envelope.team_id,
    channelId: event.channel,
    userId: event.user,
    text,
    messageTs: event.ts,
    ...(event.type === 'app_mention' ? { threadTs: event.thread_ts ?? event.ts } : event.thread_ts ? { threadTs: event.thread_ts } : {}),
    direct,
  }
}

export function slackConversationId(teamId: string, channelId: string, threadTs: string | undefined, direct: boolean): string {
  return direct
    ? `sl_${teamId}_${channelId}`
    : `sl_${teamId}_${channelId}_${(threadTs ?? 'root').replace('.', '_')}`
}

export function slackVisitorId(teamId: string, userId: string): string {
  return `sl_${teamId}_${userId}`
}
