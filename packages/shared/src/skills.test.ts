import { describe, expect, test } from 'bun:test'
import { SKILLS, skillDef, isSkillId, validateSkillConfig, meetsTier } from './skills'

describe('skill catalogue', () => {
  test('every skill has a unique id and a validating default config', () => {
    const ids = SKILLS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SKILLS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
      expect(validateSkillConfig(s.id, s.defaultConfig).ok).toBe(true)
    }
  })
  test('skillDef and isSkillId resolve known ids only', () => {
    expect(skillDef('memory')?.id).toBe('memory')
    expect(skillDef('nope')).toBeUndefined()
    expect(isSkillId('web_search')).toBe(true)
    expect(isSkillId('calendar')).toBe(false)
  })
  test('web_search is the only paid-tier skill', () => {
    expect(skillDef('web_search')?.minTier).toBe('core')
    expect(skillDef('memory')?.minTier).toBeNull()
    expect(skillDef('scoring')?.minTier).toBeNull()
  })
})

describe('meetsTier', () => {
  test('a null minTier is available on every plan including trial', () => {
    expect(meetsTier(null, null)).toBe(true)
    expect(meetsTier('lite', null)).toBe(true)
  })
  test('trial ranks below every paid plan', () => {
    expect(meetsTier(null, 'core')).toBe(false)
  })
  test('the plan must reach the minimum tier', () => {
    expect(meetsTier('lite', 'core')).toBe(false)
    expect(meetsTier('core', 'core')).toBe(true)
    expect(meetsTier('max', 'core')).toBe(true)
  })
})

describe('validateSkillConfig', () => {
  test('memory defaults retentionDays and enforces its range', () => {
    expect(validateSkillConfig('memory', {})).toEqual({ ok: true, value: { retentionDays: 90 } })
    expect(validateSkillConfig('memory', { retentionDays: 30 })).toEqual({ ok: true, value: { retentionDays: 30 } })
    expect(validateSkillConfig('memory', { retentionDays: 0 }).ok).toBe(false)
    expect(validateSkillConfig('memory', { retentionDays: 366 }).ok).toBe(false)
    expect(validateSkillConfig('memory', { retentionDays: 1.5 }).ok).toBe(false)
  })
  test('scoring accepts an omitted rubric and rejects an over-long one', () => {
    expect(validateSkillConfig('scoring', {})).toEqual({ ok: true, value: {} })
    expect(validateSkillConfig('scoring', { rubric: ' grade it ' })).toEqual({ ok: true, value: { rubric: 'grade it' } })
    expect(validateSkillConfig('scoring', { rubric: 'x'.repeat(2001) }).ok).toBe(false)
  })
  test('web_search defaults maxResults and enforces its range', () => {
    expect(validateSkillConfig('web_search', {})).toEqual({ ok: true, value: { maxResults: 3 } })
    expect(validateSkillConfig('web_search', { maxResults: 5 })).toEqual({ ok: true, value: { maxResults: 5 } })
    expect(validateSkillConfig('web_search', { maxResults: 6 }).ok).toBe(false)
    expect(validateSkillConfig('web_search', { maxResults: 0 }).ok).toBe(false)
  })
  test('a non-object body is rejected', () => {
    expect(validateSkillConfig('memory', null).ok).toBe(false)
    expect(validateSkillConfig('memory', 'nope').ok).toBe(false)
  })
})
