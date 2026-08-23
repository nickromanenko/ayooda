export interface TimingMetric {
  averageMs: number | null
  count: number
}

/** Accept Firestore timestamps or Dates without importing Firestore into analytics code. */
export function timestampDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (!value || typeof value !== 'object') return null
  const candidate = value as { toDate?: () => Date }
  return typeof candidate.toDate === 'function' ? candidate.toDate() : null
}

export function elapsedMs(from: unknown, to: Date): number | null {
  const start = timestampDate(from)
  if (!start) return null
  return Math.max(0, to.getTime() - start.getTime())
}

export function averageTiming(values: unknown[]): TimingMetric {
  const durations = values.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0)
  if (durations.length === 0) return { averageMs: null, count: 0 }
  return {
    averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    count: durations.length,
  }
}
