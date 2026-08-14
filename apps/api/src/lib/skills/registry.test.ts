import { describe, expect, test } from 'bun:test'
import { selectSkills, type SkillRow } from './registry'
import type { SkillModule } from './types'

const stub = (id: string): SkillModule<any> => ({ id: id as any })
const modules = { memory: stub('memory'), scoring: stub('scoring'), web_search: stub('web_search') }

const row = (over: Partial<SkillRow> = {}): SkillRow => ({
  id: 'memory', enabled: true, config: { retentionDays: 90 }, ...over,
})

describe('selectSkills', () => {
  test('returns enabled skills with validated config', () => {
    const out = selectSkills([row()], 'lite', modules)
    expect(out).toHaveLength(1)
    expect(out[0]!.def.id).toBe('memory')
    expect(out[0]!.config).toEqual({ retentionDays: 90 })
  })
  test('skips disabled rows', () => {
    expect(selectSkills([row({ enabled: false })], 'lite', modules)).toHaveLength(0)
  })
  test('skips unknown skill ids', () => {
    expect(selectSkills([row({ id: 'calendar' })], 'lite', modules)).toHaveLength(0)
  })
  test('skips a skill above the workspace tier', () => {
    const web = row({ id: 'web_search', config: { maxResults: 3 } })
    expect(selectSkills([web], 'lite', modules)).toHaveLength(0)
    expect(selectSkills([web], 'core', modules)).toHaveLength(1)
    expect(selectSkills([web], null, modules)).toHaveLength(0)
  })
  test('falls back to the default config when the stored config is invalid', () => {
    const out = selectSkills([row({ config: { retentionDays: 9999 } })], 'lite', modules)
    expect(out[0]!.config).toEqual({ retentionDays: 90 })
  })
  test('skips a skill with no registered module', () => {
    expect(selectSkills([row()], 'lite', {})).toHaveLength(0)
  })
  test('orders by the catalogue, not by input order', () => {
    const rows = [row({ id: 'web_search', config: { maxResults: 3 } }), row({ id: 'memory' })]
    expect(selectSkills(rows, 'max', modules).map((s) => s.def.id)).toEqual(['memory', 'web_search'])
  })
})
