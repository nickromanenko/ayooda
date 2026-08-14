import { describe, expect, test } from 'bun:test'
import { buildScoringPrompt, clampScore, DEFAULT_RUBRIC } from './scoring'

describe('buildScoringPrompt', () => {
  test('uses the default rubric when none is configured', () => {
    const p = buildScoringPrompt(undefined, 'user: hi')
    expect(p).toContain(DEFAULT_RUBRIC)
    expect(p).toContain('user: hi')
  })
  test('a configured rubric replaces the default', () => {
    const p = buildScoringPrompt('Only grade politeness.', 'user: hi')
    expect(p).toContain('Only grade politeness.')
    expect(p).not.toContain(DEFAULT_RUBRIC)
  })
})

describe('clampScore', () => {
  test('keeps scores inside 1-5 and rounds to an integer', () => {
    expect(clampScore(3)).toBe(3)
    expect(clampScore(0)).toBe(1)
    expect(clampScore(9)).toBe(5)
    expect(clampScore(3.6)).toBe(4)
  })
  test('a non-finite score falls back to the midpoint', () => {
    expect(clampScore(NaN)).toBe(3)
  })
})
