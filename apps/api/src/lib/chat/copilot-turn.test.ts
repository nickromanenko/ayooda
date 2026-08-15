import { describe, expect, test } from 'bun:test'
import { COPILOT_USAGE_FIELDS, copilotThreadPath, copilotThreadsPath, copilotUsageDelta, skillsForCopilot } from './copilot-turn'
import type { LoadedSkill } from '../skills/registry'

const loaded = (id: string): LoadedSkill => ({
  def: { id: id as never, label: id, description: '', defaultConfig: {}, minTier: null },
  module: { id: id as never },
  config: {},
})

describe('copilot Firestore paths', () => {
  const paths = [copilotThreadsPath('w1', 'u1'), copilotThreadPath('w1', 'u1', 't1')]

  test('every path is under /threads/ and per-user', () => {
    expect(copilotThreadsPath('w1', 'u1')).toBe('workspaces/w1/copilotUsers/u1/threads')
    expect(copilotThreadPath('w1', 'u1', 't1')).toBe('workspaces/w1/copilotUsers/u1/threads/t1')
    for (const p of paths) expect(p).toContain('/threads')
  })

  test('no path segment is named "conversations" — the sweep must never reach internal chats', () => {
    // lib/skills/sweep.ts runs collectionGroup('conversations') queries that auto-close and
    // score whatever they match. Renaming this collection would silently feed every member's
    // private chats into them.
    for (const p of paths) {
      expect(p.split('/')).not.toContain('conversations')
      expect(p).not.toContain('conversations')
    }
  })
})

describe('skillsForCopilot', () => {
  test('drops scoring — internal chats must not pollute conversation-quality metrics', () => {
    const out = skillsForCopilot([loaded('memory'), loaded('scoring'), loaded('web_search')])
    expect(out.map((s) => s.def.id)).toEqual(['memory', 'web_search'])
  })

  test('keeps everything else, including an empty list', () => {
    expect(skillsForCopilot([])).toEqual([])
    expect(skillsForCopilot([loaded('memory')]).map((s) => s.def.id)).toEqual(['memory'])
  })
})

describe('copilot usage accounting', () => {
  test('increments Copilot-specific counters, never the shared support ones', () => {
    // usage.messageCount feeds the dashboard's avgMessages = messageCount / conversationCount.
    // Copilot increments no conversationCount, so pointing these at the shared fields would
    // silently inflate a support metric with internal chat.
    expect(COPILOT_USAGE_FIELDS.messageCount).toBe('usage.copilotMessageCount')
    expect(COPILOT_USAGE_FIELDS.tokenCount).toBe('usage.copilotTokenCount')
    for (const field of Object.values(COPILOT_USAGE_FIELDS)) {
      expect(field).not.toBe('usage.messageCount')
      expect(field).not.toBe('usage.tokenCount')
    }
  })

  test('counts two messages per turn and sums both token directions', () => {
    expect(copilotUsageDelta(120, 45)).toEqual({ messages: 2, tokens: 165 })
  })

  test('treats missing or non-finite token counts as zero', () => {
    // runAgentTurn yields 0s when the provider omits usage; guard against NaN reaching Firestore,
    // which would corrupt the running total permanently rather than just losing one turn.
    expect(copilotUsageDelta(0, 0)).toEqual({ messages: 2, tokens: 0 })
    expect(copilotUsageDelta(NaN, 10)).toEqual({ messages: 2, tokens: 10 })
    expect(copilotUsageDelta(undefined as never, undefined as never)).toEqual({ messages: 2, tokens: 0 })
  })
})
