import { describe, expect, test } from 'bun:test'
import { skillsForCopilot } from './copilot-turn'
import type { LoadedSkill } from '../skills/registry'

const loaded = (id: string): LoadedSkill => ({
  def: { id: id as never, label: id, description: '', defaultConfig: {}, minTier: null },
  module: { id: id as never },
  config: {},
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
