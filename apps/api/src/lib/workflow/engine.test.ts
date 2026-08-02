import { describe, expect, test } from 'bun:test'
import { matchesTrigger, evaluateRules } from './engine'
import type { WorkflowRule, EscalationContext } from '@ayooda/shared'

const ctx = (over: Partial<EscalationContext> = {}): EscalationContext => ({
  messageLower: 'hello', botReplyCount: 0, sourceCount: 3, now: new Date('2026-08-03T12:00:00Z'), ...over,
})

describe('matchesTrigger', () => {
  test('ask_for_human matches a phrase substring (case-insensitive)', () => {
    const t = { type: 'ask_for_human', phrases: ['talk to a human', 'agent'] } as const
    expect(matchesTrigger(t, ctx({ messageLower: 'can i talk to a human please' }))).toBe(true)
    expect(matchesTrigger(t, ctx({ messageLower: 'what are your hours' }))).toBe(false)
  })
  test('low_confidence fires only when there are 0 sources', () => {
    expect(matchesTrigger({ type: 'low_confidence' }, ctx({ sourceCount: 0 }))).toBe(true)
    expect(matchesTrigger({ type: 'low_confidence' }, ctx({ sourceCount: 1 }))).toBe(false)
  })
  test('bot_replies fires at or above the count', () => {
    expect(matchesTrigger({ type: 'bot_replies', count: 3 }, ctx({ botReplyCount: 3 }))).toBe(true)
    expect(matchesTrigger({ type: 'bot_replies', count: 3 }, ctx({ botReplyCount: 2 }))).toBe(false)
  })
  test('keyword matches any keyword substring', () => {
    const t = { type: 'keyword', keywords: ['refund', 'cancel'] } as const
    expect(matchesTrigger(t, ctx({ messageLower: 'i want a refund' }))).toBe(true)
    expect(matchesTrigger(t, ctx({ messageLower: 'thanks!' }))).toBe(false)
  })
  test('off_hours respects the timezone', () => {
    const base = { type: 'off_hours', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' } as const
    // 12:00 UTC is inside 09–17 in UTC → open → does not fire
    expect(matchesTrigger({ ...base, timezone: 'UTC' }, ctx())).toBe(false)
    // Same instant is 08:00 in New York (EDT, UTC-4) → before 09:00 → closed → fires
    expect(matchesTrigger({ ...base, timezone: 'America/New_York' }, ctx())).toBe(true)
  })
  test('off_hours with no open days is always closed', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'UTC', days: [], start: '09:00', end: '17:00' }, ctx())).toBe(true)
  })
  test('off_hours fires outside the window', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' }, ctx({ now: new Date('2026-08-03T20:00:00Z') }))).toBe(true)
  })
  test('off_hours with a bad timezone never fires', () => {
    expect(matchesTrigger({ type: 'off_hours', timezone: 'Not/AZone', days: [], start: '09:00', end: '17:00' }, ctx())).toBe(false)
  })
})

describe('evaluateRules', () => {
  const rule = (over: Partial<WorkflowRule>): WorkflowRule => ({
    id: 'r', name: 'r', enabled: true, order: 0, trigger: { type: 'low_confidence' }, action: { type: 'escalate' }, ...over,
  })
  test('returns the first enabled rule (by order) that matches', () => {
    const rules = [
      rule({ id: 'b', order: 1, trigger: { type: 'keyword', keywords: ['refund'] } }),
      rule({ id: 'a', order: 0, trigger: { type: 'low_confidence' } }),
    ]
    expect(evaluateRules(rules, ctx({ sourceCount: 0, messageLower: 'refund' }))?.id).toBe('a')
  })
  test('skips disabled rules', () => {
    const rules = [rule({ id: 'a', enabled: false, trigger: { type: 'low_confidence' } })]
    expect(evaluateRules(rules, ctx({ sourceCount: 0 }))).toBeNull()
  })
  test('returns null when nothing matches', () => {
    expect(evaluateRules([rule({ trigger: { type: 'low_confidence' } })], ctx({ sourceCount: 2 }))).toBeNull()
  })
})
