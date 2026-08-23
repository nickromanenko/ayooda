export const KNOWLEDGE_SYNC_INTERVAL_HOURS = [24, 168, 720] as const

export type KnowledgeSyncIntervalHours = (typeof KNOWLEDGE_SYNC_INTERVAL_HOURS)[number]

export const KNOWLEDGE_SYNC_LEASE_MINUTES = 60

export function isKnowledgeSyncInterval(value: unknown): value is KnowledgeSyncIntervalHours {
  return typeof value === 'number' && KNOWLEDGE_SYNC_INTERVAL_HOURS.includes(value as KnowledgeSyncIntervalHours)
}

export function nextKnowledgeSyncAt(now: Date, intervalHours: KnowledgeSyncIntervalHours): Date {
  return new Date(now.getTime() + intervalHours * 60 * 60_000)
}

export function knowledgeSyncLeaseUntil(now: Date): Date {
  return new Date(now.getTime() + KNOWLEDGE_SYNC_LEASE_MINUTES * 60_000)
}

/** Retry after 1, 2, 4, 8, 16, then 24 hours. */
export function knowledgeSyncRetryAt(now: Date, failureCount: number): Date {
  const hours = Math.min(24, 2 ** Math.max(0, Math.min(failureCount - 1, 5)))
  return new Date(now.getTime() + hours * 60 * 60_000)
}
