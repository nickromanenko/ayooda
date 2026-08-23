import { describe, expect, test } from 'bun:test'
import { validateRule } from './validate'

const base = { name: 'Ask for human', enabled: true, action: { type: 'escalate', handoffMessage: 'Hold on' } }

describe('validateRule', () => {
  test('accepts an ask_for_human rule', () => {
    const r = validateRule({ ...base, trigger: { type: 'ask_for_human', phrases: ['human', 'agent'] } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.trigger.type).toBe('ask_for_human')
  })
  test('accepts a bot_replies rule and coerces enabled default', () => {
    const r = validateRule({ name: 'N', action: { type: 'escalate' }, trigger: { type: 'bot_replies', count: 3 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.enabled).toBe(true)
  })
  test('rejects a bad trigger type', () => {
    expect(validateRule({ ...base, trigger: { type: 'nope' } }).ok).toBe(false)
  })
  test('rejects bot_replies with a non-positive count', () => {
    expect(validateRule({ ...base, trigger: { type: 'bot_replies', count: 0 } }).ok).toBe(false)
  })
  test('rejects ask_for_human with no phrases', () => {
    expect(validateRule({ ...base, trigger: { type: 'ask_for_human', phrases: [] } }).ok).toBe(false)
  })
  test('rejects off_hours with a bad timezone', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'Bad/Zone', days: [1], start: '09:00', end: '17:00' } }).ok).toBe(false)
  })
  test('accepts a valid off_hours rule', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } }).ok).toBe(true)
  })
  test('rejects a bad start time format', () => {
    expect(validateRule({ ...base, trigger: { type: 'off_hours', timezone: 'UTC', days: [1], start: '9am', end: '17:00' } }).ok).toBe(false)
  })
  test('rejects an over-length handoff message', () => {
    expect(validateRule({ name: 'N', action: { type: 'escalate', handoffMessage: 'x'.repeat(501) }, trigger: { type: 'low_confidence' } }).ok).toBe(false)
  })
  test('accepts every richer terminal action', () => {
    const trigger = { type: 'low_confidence' }
    expect(validateRule({ name: 'Reply', trigger, action: { type: 'reply', message: 'One moment', continue: true } }).ok).toBe(true)
    expect(validateRule({ name: 'Resolve', trigger, action: { type: 'resolve', message: 'All set' } }).ok).toBe(true)
    expect(validateRule({ name: 'Assign', trigger, action: { type: 'assign_teammate', teammateUid: 'user_1' } }).ok).toBe(true)
    expect(validateRule({ name: 'Route', trigger, action: { type: 'route_agent', agentId: 'agent_2' } }).ok).toBe(true)
  })
  test('requires reply content and action targets', () => {
    const trigger = { type: 'low_confidence' }
    expect(validateRule({ name: 'Reply', trigger, action: { type: 'reply', message: '' } }).ok).toBe(false)
    expect(validateRule({ name: 'Assign', trigger, action: { type: 'assign_teammate', teammateUid: '' } }).ok).toBe(false)
    expect(validateRule({ name: 'Route', trigger, action: { type: 'route_agent', agentId: '../other' } }).ok).toBe(false)
  })
  test('normalizes reply continuation to an explicit boolean', () => {
    const result = validateRule({
      name: 'Reply', trigger: { type: 'keyword', keywords: ['refund'] },
      action: { type: 'reply', message: '  Checking that now.  ', continue: 'yes' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.action).toEqual({ type: 'reply', message: 'Checking that now.', continue: false })
  })
})
