import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { knowledgeDate, knowledgeHealth, summarizeKnowledge } from './knowledge-health'

const now = new Date('2026-08-30T12:00:00Z')

describe('knowledge health', () => {
  it('reads ISO and Firestore timestamps', () => {
    assert.equal(knowledgeDate('2026-08-01T00:00:00Z')?.toISOString(), '2026-08-01T00:00:00.000Z')
    assert.equal(knowledgeDate({ seconds: 1_722_470_400 })?.toISOString(), '2024-08-01T00:00:00.000Z')
    assert.equal(knowledgeDate('not-a-date'), null)
  })

  it('prioritizes failures and active work', () => {
    assert.equal(knowledgeHealth({ type: 'file', status: 'indexed', chunkCount: 3, syncError: 'failed' }, now), 'error')
    assert.equal(knowledgeHealth({ type: 'file', status: 'processing', chunkCount: 0 }, now), 'processing')
    assert.equal(knowledgeHealth({ type: 'file', status: 'indexed', chunkCount: 0 }, now), 'empty')
  })

  it('flags unsynced webpages after 30 days but not static files', () => {
    const old = '2026-07-01T00:00:00Z'
    assert.equal(knowledgeHealth({ type: 'webpage', status: 'indexed', chunkCount: 4, indexedAt: old }, now), 'stale')
    assert.equal(knowledgeHealth({ type: 'webpage', status: 'indexed', chunkCount: 4, indexedAt: old, autoSyncEnabled: true }, now), 'ready')
    assert.equal(knowledgeHealth({ type: 'file', status: 'indexed', chunkCount: 4, indexedAt: old }, now), 'ready')
  })

  it('summarizes readiness and actionable issues', () => {
    const summary = summarizeKnowledge([
      { type: 'file', status: 'indexed' as const, chunkCount: 4 },
      { type: 'webpage', status: 'error' as const, chunkCount: 0 },
      { type: 'file', status: 'processing' as const, chunkCount: 0 },
    ], now)
    assert.deepEqual(summary, { total: 3, ready: 1, processing: 1, errors: 1, stale: 0, empty: 0, issues: 1, chunks: 4, readiness: 33 })
  })
})
