import type { TriggerType, WorkflowTrigger, WorkflowAction } from '@ayooda/shared'

export interface ValidatedRule {
  name: string
  enabled: boolean
  trigger: WorkflowTrigger
  action: WorkflowAction
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

const TRIGGER_TYPES: TriggerType[] = ['ask_for_human', 'low_confidence', 'bot_replies', 'keyword', 'off_hours']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const TARGET_ID = /^[A-Za-z0-9_-]{1,160}$/

function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

function cleanStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
}

function validateTrigger(raw: unknown): { ok: true; value: WorkflowTrigger } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Trigger is required.')
  const t = raw as Record<string, unknown>
  const type = t.type as TriggerType
  if (!TRIGGER_TYPES.includes(type)) return fail('Unknown trigger type.')
  switch (type) {
    case 'ask_for_human': {
      const phrases = cleanStrings(t.phrases)
      if (phrases.length < 1 || phrases.length > 20) return fail('Add 1–20 phrases.')
      return { ok: true, value: { type, phrases } }
    }
    case 'keyword': {
      const keywords = cleanStrings(t.keywords)
      if (keywords.length < 1 || keywords.length > 20) return fail('Add 1–20 keywords.')
      return { ok: true, value: { type, keywords } }
    }
    case 'low_confidence':
      return { ok: true, value: { type } }
    case 'bot_replies': {
      const count = Number(t.count)
      if (!Number.isInteger(count) || count < 1 || count > 50) return fail('Count must be 1–50.')
      return { ok: true, value: { type, count } }
    }
    case 'off_hours': {
      const timezone = typeof t.timezone === 'string' ? t.timezone : ''
      if (!validTimezone(timezone)) return fail('Invalid timezone.')
      const days = Array.isArray(t.days) ? t.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []
      const start = typeof t.start === 'string' ? t.start : ''
      const end = typeof t.end === 'string' ? t.end : ''
      if (!HHMM.test(start) || !HHMM.test(end)) return fail('Times must be HH:MM (24h).')
      return { ok: true, value: { type, timezone, days: [...new Set(days)], start, end } }
    }
    default:
      return fail('Unknown trigger type.')
  }
}

function optionalMessage(raw: unknown, label: string): { ok: true; value?: string } | Fail {
  if (raw === undefined || raw === null || raw === '') return { ok: true }
  if (typeof raw !== 'string') return fail(`${label} must be text.`)
  const value = raw.trim()
  if (value.length > 500) return fail(`${label} is too long (max 500).`)
  return value ? { ok: true, value } : { ok: true }
}

function targetId(raw: unknown, label: string): { ok: true; value: string } | Fail {
  if (typeof raw !== 'string' || !TARGET_ID.test(raw)) return fail(`${label} is required.`)
  return { ok: true, value: raw }
}

function validateAction(raw: unknown): { ok: true; value: WorkflowAction } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Action is required.')
  const action = raw as Record<string, unknown>

  switch (action.type) {
    case 'escalate': {
      const message = optionalMessage(action.handoffMessage, 'Handoff message')
      if (!message.ok) return message
      return { ok: true, value: { type: 'escalate', ...(message.value ? { handoffMessage: message.value } : {}) } }
    }
    case 'reply': {
      const message = optionalMessage(action.message, 'Response message')
      if (!message.ok) return message
      if (!message.value) return fail('Response message is required.')
      return { ok: true, value: { type: 'reply', message: message.value, continue: action.continue === true } }
    }
    case 'resolve': {
      const message = optionalMessage(action.message, 'Resolution message')
      if (!message.ok) return message
      return { ok: true, value: { type: 'resolve', ...(message.value ? { message: message.value } : {}) } }
    }
    case 'assign_teammate': {
      const teammate = targetId(action.teammateUid, 'Teammate')
      if (!teammate.ok) return teammate
      const message = optionalMessage(action.message, 'Assignment message')
      if (!message.ok) return message
      return { ok: true, value: { type: 'assign_teammate', teammateUid: teammate.value, ...(message.value ? { message: message.value } : {}) } }
    }
    case 'route_agent': {
      const agent = targetId(action.agentId, 'Agent')
      if (!agent.ok) return agent
      const message = optionalMessage(action.message, 'Routing message')
      if (!message.ok) return message
      return { ok: true, value: { type: 'route_agent', agentId: agent.value, ...(message.value ? { message: message.value } : {}) } }
    }
    default:
      return fail('Unknown workflow action.')
  }
}

export function validateRule(raw: unknown): { ok: true; value: ValidatedRule } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Invalid request body.')
  const o = raw as Record<string, unknown>

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name.length < 1 || name.length > 80) return fail('Name must be 1–80 characters.')

  const enabled = o.enabled === undefined ? true : o.enabled === true

  const trig = validateTrigger(o.trigger)
  if (!trig.ok) return trig

  const action = validateAction(o.action)
  if (!action.ok) return action

  return { ok: true, value: { name, enabled, trigger: trig.value, action: action.value } }
}
