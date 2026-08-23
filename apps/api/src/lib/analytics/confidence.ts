import { timestampDate } from './timing'

export const LOW_KNOWLEDGE_CONFIDENCE = 70
export const CONFIDENCE_TREND_DAYS = 30

export interface ConfidenceCounters {
  confidenceSum?: unknown
  confidenceSamples?: unknown
  confidenceLowSamples?: unknown
}

export interface ConfidenceDay extends ConfidenceCounters {
  date?: unknown
}

export interface ConfidencePoint {
  date: string
  average: number | null
  count: number
}

export interface ConfidenceSummary {
  average: number | null
  lowRate: number | null
  count: number
  threshold: number
  trend: ConfidencePoint[]
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Strongest accepted retrieval match, normalized to a percentage. No evidence is 0%. */
export function knowledgeConfidence(sources: Array<{ score: number }>): number {
  const scores = sources.map((source) => source.score).filter(Number.isFinite)
  if (scores.length === 0) return 0
  return Math.round(Math.min(1, Math.max(0, Math.max(...scores))) * 100)
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function average(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null
}

export function confidenceSummary(
  daily: ConfidenceDay[],
  now: Date,
): ConfidenceSummary {
  const byDate = new Map<string, { sum: number; count: number; low: number }>()
  for (const row of daily) {
    const rawDate = typeof row.date === 'string' ? row.date : timestampDate(row.date)?.toISOString().slice(0, 10)
    if (!rawDate) continue
    const samples = finiteNonNegative(row.confidenceSamples)
    const rowSum = finiteNonNegative(row.confidenceSum)
    const lowSamples = Math.min(samples, finiteNonNegative(row.confidenceLowSamples))
    const current = byDate.get(rawDate) ?? { sum: 0, count: 0, low: 0 }
    byDate.set(rawDate, { sum: current.sum + rowSum, count: current.count + samples, low: current.low + lowSamples })
  }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const trend: ConfidencePoint[] = []
  let count = 0
  let sum = 0
  let low = 0
  for (let offset = CONFIDENCE_TREND_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(today.getTime() - offset * 86_400_000)
    const key = utcDateKey(date)
    const point = byDate.get(key) ?? { sum: 0, count: 0, low: 0 }
    count += point.count
    sum += point.sum
    low += point.low
    trend.push({ date: key, average: average(point.sum, point.count), count: point.count })
  }

  return {
    average: average(sum, count),
    lowRate: count > 0 ? Math.round((low / count) * 100) : null,
    count,
    threshold: LOW_KNOWLEDGE_CONFIDENCE,
    trend,
  }
}
