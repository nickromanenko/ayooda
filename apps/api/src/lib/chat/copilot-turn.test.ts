import { describe, expect, test } from 'bun:test'
import { copilotThreadPath, copilotThreadsPath, skillsForCopilot } from './copilot-turn'
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
