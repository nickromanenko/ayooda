import { averageTiming, timestampDate } from './timing'

export const USAGE_TREND_DAYS = 30

type TrendRow = {
  createdAt?: unknown
  status?: unknown
  hadTakeover?: unknown
  firstReplyMs?: unknown
  score?: unknown
}

type TrendValue = { current: number | null; previous: number | null; delta: number | null }

function roundedAverage(values: number[], digits = 0): number | null {
  if (!values.length) return null
  const scale = 10 ** digits
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * scale) / scale
}

function rate(part: number, total: number): number | null {
  return total ? Math.round(part / total * 100) : null
}

function trend(current: number | null, previous: number | null): TrendValue {
  return { current, previous, delta: current !== null && previous !== null ? Math.round((current - previous) * 10) / 10 : null }
}

function metrics(rows: TrendRow[]) {
  const resolved = rows.filter((row) => row.status === 'resolved')
  const automated = resolved.filter((row) => row.hadTakeover !== true)
  const handedOff = rows.filter((row) => row.hadTakeover === true || row.status === 'waiting')
  const scores = rows.map((row) => row.score).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5)
  return {
    conversations: rows.length,
    automationRate: rate(automated.length, resolved.length),
    handoffRate: rate(handedOff.length, rows.length),
    csat: roundedAverage(scores, 1),
    firstReplyMs: averageTiming(rows.map((row) => row.firstReplyMs)).averageMs,
  }
}

export function periodTrends(rows: TrendRow[], now: Date) {
  const currentStart = now.getTime() - USAGE_TREND_DAYS * 86_400_000
  const previousStart = currentStart - USAGE_TREND_DAYS * 86_400_000
  const currentRows: TrendRow[] = []
  const previousRows: TrendRow[] = []
  for (const row of rows) {
    const createdAt = timestampDate(row.createdAt)?.getTime()
    if (createdAt === undefined || createdAt === null) continue
    if (createdAt >= currentStart) currentRows.push(row)
    else if (createdAt >= previousStart) previousRows.push(row)
  }
  const current = metrics(currentRows)
  const previous = metrics(previousRows)
  return {
    days: USAGE_TREND_DAYS,
    conversations: trend(current.conversations, previous.conversations),
    automationRate: trend(current.automationRate, previous.automationRate),
    handoffRate: trend(current.handoffRate, previous.handoffRate),
    csat: trend(current.csat, previous.csat),
    firstReplyMs: trend(current.firstReplyMs, previous.firstReplyMs),
  }
}
