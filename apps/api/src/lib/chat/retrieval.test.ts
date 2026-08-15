import { describe, expect, test } from 'bun:test'
import { selectMatches, retrieveContext } from './retrieval'

const trace = { span: () => ({ end: () => {} }) } as never

describe('selectMatches', () => {
  test('keeps only matches above the 0.6 threshold', () => {
    const out = selectMatches([
      { score: 0.9, metadata: { docId: 'd1', source: 's1', text: 'keep me' } },
      { score: 0.6, metadata: { docId: 'd2', source: 's2', text: 'exactly at threshold' } },
      { score: 0.59, metadata: { docId: 'd3', source: 's3', text: 'too weak' } },
    ])
    // 0.6 is NOT kept — the existing filter is a strict `>`, and changing it
    // would silently alter every answer's context.
    expect(out.sources.map((s) => s.docId)).toEqual(['d1'])
    expect(out.contextBlocks).toEqual(['keep me'])
  })

  test('drops matches whose text is missing but keeps their source entry', () => {
    const out = selectMatches([{ score: 0.8, metadata: { docId: 'd1', source: 's1' } }])
    expect(out.sources).toHaveLength(1)
    expect(out.contextBlocks).toEqual([])
  })

  test('handles no matches at all', () => {
    expect(selectMatches([])).toEqual({ contextBlocks: [], sources: [] })
    expect(selectMatches(undefined)).toEqual({ contextBlocks: [], sources: [] })
  })
})

describe('retrieveContext', () => {
  test('returns matches on the happy path', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => [0.1, 0.2],
      query: async () => ({ matches: [{ score: 0.9, metadata: { docId: 'd', source: 's', text: 't' } }] }),
    })
    expect(out.contextBlocks).toEqual(['t'])
  })

  test('is non-fatal: an embedding failure yields empty context, never a rejection', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => { throw new Error('gemini down') },
      query: async () => ({ matches: [] }),
    })
    expect(out).toEqual({ contextBlocks: [], sources: [] })
  })

  test('is non-fatal: a Pinecone failure yields empty context', async () => {
    const out = await retrieveContext('ns', 'hello', trace, {
      embed: async () => [0.1],
      query: async () => { throw new Error('pinecone down') },
    })
    expect(out).toEqual({ contextBlocks: [], sources: [] })
  })
})
