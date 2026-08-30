import type { KnowledgeDocStatus } from '@ayooda/shared'

export type KnowledgeTimestamp = string | { _seconds?: number; seconds?: number } | null

export type KnowledgeHealthInput = {
  type: string
  status: KnowledgeDocStatus
  chunkCount: number
  indexedAt?: KnowledgeTimestamp
  autoSyncEnabled?: boolean
  syncError?: string | null
}

export type KnowledgeHealth = 'ready' | 'processing' | 'error' | 'empty' | 'stale'

export const KNOWLEDGE_STALE_DAYS = 30

export function knowledgeDate(value: KnowledgeTimestamp | undefined): Date | null {
  if (!value) return null
  const date = typeof value === 'string'
    ? new Date(value)
    : new Date((value._seconds ?? value.seconds ?? 0) * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

export function knowledgeHealth(source: KnowledgeHealthInput, now = new Date()): KnowledgeHealth {
  if (source.status === 'error' || source.syncError) return 'error'
  if (source.status === 'pending' || source.status === 'processing') return 'processing'
  if (source.chunkCount <= 0) return 'empty'
  if (source.type === 'webpage' && !source.autoSyncEnabled) {
    const indexedAt = knowledgeDate(source.indexedAt)
    if (!indexedAt || now.getTime() - indexedAt.getTime() > KNOWLEDGE_STALE_DAYS * 86_400_000) return 'stale'
  }
  return 'ready'
}

export function summarizeKnowledge<T extends KnowledgeHealthInput>(sources: T[], now = new Date()) {
  const states = sources.map((source) => knowledgeHealth(source, now))
  const ready = states.filter((state) => state === 'ready').length
  const processing = states.filter((state) => state === 'processing').length
  const errors = states.filter((state) => state === 'error').length
  const stale = states.filter((state) => state === 'stale').length
  const empty = states.filter((state) => state === 'empty').length
  return {
    total: sources.length,
    ready,
    processing,
    errors,
    stale,
    empty,
    issues: errors + stale + empty,
    chunks: sources.reduce((sum, source) => sum + Math.max(0, Number(source.chunkCount) || 0), 0),
    readiness: sources.length ? Math.round((ready / sources.length) * 100) : 0,
  }
}
