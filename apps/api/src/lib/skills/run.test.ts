import { describe, expect, test } from 'bun:test'
import { gatherContext, gatherTools } from './run'
import type { LoadedSkill } from './registry'
import type { SkillContext, SkillModule } from './types'

const trace = { span: () => ({ end: () => {} }) } as any
const ctx = {
  workspaceId: 'w', agentId: 'a', conversationId: 'c', visitorId: 'v',
  message: 'hi', config: {}, trace,
} as SkillContext<any>

const loaded = (module: SkillModule<any>): LoadedSkill => ({
  def: { id: module.id, label: 'L', description: 'D', defaultConfig: {}, minTier: null },
  module, config: {},
})

describe('gatherContext', () => {
  test('collects non-null blocks in order', async () => {
    const a = loaded({ id: 'memory', contributeContext: async () => 'A' })
    const b = loaded({ id: 'scoring', contributeContext: async () => 'B' })
    expect(await gatherContext([a, b], ctx)).toEqual(['A', 'B'])
  })
  test('skips skills with no hook and null returns', async () => {
    const none = loaded({ id: 'memory' })
    const nul = loaded({ id: 'scoring', contributeContext: async () => null })
    expect(await gatherContext([none, nul], ctx)).toEqual([])
  })
  test('a throwing skill is skipped and the rest still contribute', async () => {
    const boom = loaded({ id: 'memory', contributeContext: async () => { throw new Error('boom') } })
    const ok = loaded({ id: 'scoring', contributeContext: async () => 'OK' })
    expect(await gatherContext([boom, ok], ctx)).toEqual(['OK'])
  })
})

describe('gatherTools', () => {
  test('merges tool sets from every skill', async () => {
    const a = loaded({ id: 'web_search', contributeTools: async () => ({ web_search: {} as any }) })
    const b = loaded({ id: 'memory', contributeTools: async () => ({ other: {} as any }) })
    expect(Object.keys(await gatherTools([a, b], ctx)).sort()).toEqual(['other', 'web_search'])
  })
  test('a throwing skill contributes nothing and does not break the rest', async () => {
    const boom = loaded({ id: 'memory', contributeTools: async () => { throw new Error('boom') } })
    const ok = loaded({ id: 'web_search', contributeTools: async () => ({ web_search: {} as any }) })
    expect(Object.keys(await gatherTools([boom, ok], ctx))).toEqual(['web_search'])
  })
})
