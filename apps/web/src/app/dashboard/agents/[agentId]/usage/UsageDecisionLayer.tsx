import Link from 'next/link'
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Lightbulb, Siren, Sparkles } from 'lucide-react'
import { buildUsageInsights, type UsageInsightInput } from '@/lib/usage-insights'
import styles from './page.module.css'

type Trend = { current: number | null; previous: number | null; delta: number | null }
export type UsageTrends = {
  days: number
  conversations: Trend
  automationRate: Trend
  handoffRate: Trend
  csat: Trend
  firstReplyMs: Trend
}

function InsightIcon({ level }: { level: 'urgent' | 'warning' | 'opportunity' | 'positive' }) {
  if (level === 'urgent') return <Siren size={14} />
  if (level === 'warning') return <AlertTriangle size={14} />
  if (level === 'positive') return <CheckCircle2 size={14} />
  return <Lightbulb size={14} />
}

function formatDuration(ms: number): string {
  if (Math.abs(ms) < 60_000) return `${Math.abs(ms / 1000).toFixed(0)}s`
  return `${Math.abs(ms / 60_000).toFixed(0)}m`
}

function TrendCard({ label, trend, suffix = '', inverse = false, format }: { label: string; trend: Trend; suffix?: string; inverse?: boolean; format?: (value: number) => string }) {
  const delta = trend.delta
  const improved = delta !== null ? (inverse ? delta < 0 : delta > 0) : null
  const render = format ?? ((value: number) => `${value}${suffix}`)
  return (
    <div className={styles.trendCard}>
      <span>{label}</span>
      <strong>{trend.current === null ? '—' : render(trend.current)}</strong>
      <small className={delta === null || delta === 0 ? styles.trendNeutral : improved ? styles.trendGood : styles.trendBad}>
        {delta === null ? <><ArrowRight size={11} /> No comparison</> : delta === 0 ? <><ArrowRight size={11} /> No change</> : delta > 0 ? <><ArrowUpRight size={11} /> {format ? format(delta) : `+${render(delta)}`}</> : <><ArrowDownRight size={11} /> {format ? format(delta) : render(delta)}</>}
      </small>
    </div>
  )
}

export default function UsageDecisionLayer({ input, trends }: { input: UsageInsightInput; trends: UsageTrends | null }) {
  const insights = buildUsageInsights(input)
  return (
    <>
      <section className={styles.insights} aria-labelledby="usage-insights-title">
        <header><span><Sparkles size={15} /></span><div><h2 id="usage-insights-title">What needs attention</h2><p>Prioritized from current customer and agent activity.</p></div></header>
        <div className={styles.insightList}>{insights.map((insight) => (
          <article key={insight.id} className={styles.insight} data-level={insight.level}>
            <span className={styles.insightIcon}><InsightIcon level={insight.level} /></span>
            <div><h3>{insight.title}</h3><p>{insight.detail}</p></div>
            <Link href={insight.href}>{insight.action} →</Link>
          </article>
        ))}</div>
      </section>

      {trends && (
        <section className={styles.trends} aria-labelledby="performance-trends-title">
          <header><div><h2 id="performance-trends-title">Performance direction</h2><p>Latest {trends.days} days compared with the previous {trends.days} days.</p></div></header>
          <div className={styles.trendGrid}>
            <TrendCard label="Conversations" trend={trends.conversations} />
            <TrendCard label="Automation" trend={trends.automationRate} suffix="%" />
            <TrendCard label="Hand-off rate" trend={trends.handoffRate} suffix="%" inverse />
            <TrendCard label="CSAT" trend={trends.csat} format={(value) => Math.abs(value).toFixed(1)} />
            <TrendCard label="First reply" trend={trends.firstReplyMs} inverse format={formatDuration} />
          </div>
          <p className={styles.trendNote}>Changes are directional, not causal. Review sample sizes before changing the agent.</p>
        </section>
      )}
    </>
  )
}
