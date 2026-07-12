import { describe, expect, test } from 'bun:test'
import { validateKnowledgeFile, MAX_UPLOAD_BYTES, LLM_MODELS, GEMINI_MODELS, findModel, providerOf, PLANS, planFor, TRIAL_DAYS, TRIAL_CONVERSATION_CAP } from './index'

describe('validateKnowledgeFile', () => {
  test('accepts allowed extensions under the size cap', () => {
    for (const name of ['a.pdf', 'b.docx', 'c.txt', 'd.csv', 'e.md', 'F.PDF']) {
      expect(validateKnowledgeFile(name, 1024)).toEqual({ ok: true })
    }
  })
  test('rejects filenames with path separators or dot-dot', () => {
    for (const name of ['../evil.pdf', 'a/b.pdf', 'a\\b.pdf', 'notes..md']) {
      const res = validateKnowledgeFile(name, 10)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe('Invalid filename.')
    }
  })
  test('rejects disallowed extensions', () => {
    const res = validateKnowledgeFile('malware.exe', 10)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Unsupported file type')
  })
  test('rejects files without an extension', () => {
    expect(validateKnowledgeFile('README', 10).ok).toBe(false)
  })
  test('rejects files over the size cap', () => {
    const res = validateKnowledgeFile('big.pdf', MAX_UPLOAD_BYTES + 1)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('10 MB')
  })
  test('accepts a file exactly at the cap', () => {
    expect(validateKnowledgeFile('edge.pdf', MAX_UPLOAD_BYTES)).toEqual({ ok: true })
  })
})

describe('LLM catalog', () => {
  test('every model has a unique slug and a valid provider', () => {
    const seen = new Set<string>()
    for (const m of LLM_MODELS) {
      expect(['gemini', 'claude', 'openai']).toContain(m.provider)
      expect(m.id).toContain('/') // OpenRouter slugs are vendor/model
      expect(seen.has(m.id)).toBe(false)
      seen.add(m.id)
    }
    expect(LLM_MODELS.length).toBeGreaterThanOrEqual(6)
  })
  test('GEMINI_MODELS is the gemini subset', () => {
    expect(GEMINI_MODELS.length).toBeGreaterThan(0)
    expect(GEMINI_MODELS.every((m) => m.provider === 'gemini')).toBe(true)
  })
  test('findModel and providerOf resolve a known slug', () => {
    const first = LLM_MODELS[0]
    expect(findModel(first.id)).toEqual(first)
    expect(providerOf(first.id)).toBe(first.provider)
  })
  test('providerOf returns undefined for an unknown slug', () => {
    expect(providerOf('nope/nope')).toBeUndefined()
    expect(findModel('nope/nope')).toBeUndefined()
  })
})

describe('billing plans', () => {
  test('three tiers with the agreed caps and prices', () => {
    expect(PLANS.map((p) => p.tier)).toEqual(['lite', 'core', 'max'])
    expect(PLANS.map((p) => p.conversationCap)).toEqual([100, 500, 1500])
    expect(PLANS.map((p) => p.priceUsd)).toEqual([25, 55, 195])
  })
  test('planFor resolves a tier, undefined for null/unknown', () => {
    expect(planFor('core')?.conversationCap).toBe(500)
    expect(planFor(null)).toBeUndefined()
  })
  test('trial constants', () => {
    expect(TRIAL_DAYS).toBe(14)
    expect(TRIAL_CONVERSATION_CAP).toBe(50)
  })
})
