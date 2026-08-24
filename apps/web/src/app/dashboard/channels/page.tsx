'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, Bot, CheckCircle2, CircleAlert, Globe2, Loader2, Mail, MessageSquare, RefreshCw, Smartphone } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import styles from './page.module.css'

type Status = 'healthy' | 'failing' | 'unchecked' | 'inactive'
interface ReliabilityEvent { id: string; direction: string; outcome: 'success' | 'failure'; stage: string; detail: string | null; occurredAt: string | null }
interface ChannelHealth {
  id: string; type: string; agentName: string; status: Status; successCount: number; failureCount: number; consecutiveFailures: number
  lastEventAt: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; lastFailureAt: string | null
  lastStage: string | null; lastDetail: string | null; events: ReliabilityEvent[]
}
interface ReliabilityResponse { summary: { total: number; healthy: number; failing: number; unchecked: number }; channels: ChannelHealth[] }

const providerNames: Record<string, string> = { web_widget: 'Web widget', telegram: 'Telegram', email: 'Email', slack: 'Slack', sms: 'SMS' }
const providerIcons = { web_widget: Globe2, telegram: Bot, email: Mail, slack: MessageSquare, sms: Smartphone }
const statusLabels: Record<Status, string> = { healthy: 'Healthy', failing: 'Needs attention', unchecked: 'Not checked', inactive: 'Inactive' }

function ago(value: string | null): string {
  if (!value) return 'Never'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function stageLabel(stage: string): string {
  return stage.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

export default function ChannelReliabilityPage() {
  const [data, setData] = useState<ReliabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await apiRequest('/channels/reliability')
      const body = await response.json().catch(() => ({})) as ReliabilityResponse & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load channel health.')
      setData(body)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load channel health.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function check(channelId: string) {
    setChecking((current) => new Set(current).add(channelId)); setError('')
    try {
      await apiRequest(`/channels/${channelId}/diagnose`, { method: 'POST' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connection check failed.')
    } finally {
      setChecking((current) => { const next = new Set(current); next.delete(channelId); return next })
    }
  }

  async function checkOne(channelId: string) { await check(channelId); await load() }
  async function checkAll() {
    if (!data) return
    await Promise.all(data.channels.map((channel) => check(channel.id)))
    await load()
  }

  if (loading) return <Loading />
  const summary = data?.summary ?? { total: 0, healthy: 0, failing: 0, unchecked: 0 }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Channel health</h1>
          <p className={styles.lede}>Check provider credentials, spot delivery failures, and inspect recent inbound and outbound activity across every deployed agent.</p>
        </div>
        <button className={styles.button} type="button" onClick={() => void checkAll()} disabled={!data?.channels.length || checking.size > 0}>
          {checking.size > 0 ? <Loader2 size={15} className={styles.spin} /> : <Activity size={15} />}
          {checking.size > 0 ? `Checking ${checking.size}…` : 'Run all checks'}
        </button>
      </header>

      {error && <div className={styles.notice} role="alert">{error}</div>}

      <section className={styles.summary} aria-label="Channel health summary">
        {[['Connected', summary.total], ['Healthy', summary.healthy], ['Needs attention', summary.failing], ['Not checked', summary.unchecked]].map(([label, value]) => (
          <div className={styles.metric} key={String(label)}><p className={styles.metricValue}>{value}</p><p className={styles.metricLabel}>{label}</p></div>
        ))}
      </section>

      {!data?.channels.length ? <div className={styles.empty}>No channels are connected yet. Deploy an agent to start monitoring delivery health.</div> : (
        <section className={styles.grid} aria-label="Connected channels">
          {data.channels.map((channel) => {
            const Icon = providerIcons[channel.type as keyof typeof providerIcons] ?? Activity
            const busy = checking.has(channel.id)
            return (
              <article className={styles.card} key={channel.id}>
                <div className={styles.cardTop}>
                  <div className={styles.providerIcon}><Icon size={18} strokeWidth={1.6} /></div>
                  <div className={styles.identity}><h2 className={styles.provider}>{providerNames[channel.type] ?? channel.type}</h2><p className={styles.agent}>{channel.agentName}</p></div>
                  <span className={`${styles.status} ${styles[channel.status]}`}><span className={styles.statusDot} />{statusLabels[channel.status]}</span>
                </div>

                <div className={styles.facts}>
                  <div className={styles.fact}><p className={styles.factValue}>{channel.successCount}</p><p className={styles.factLabel}>Successful</p></div>
                  <div className={styles.fact}><p className={styles.factValue}>{channel.failureCount}</p><p className={styles.factLabel}>Failed</p></div>
                  <div className={styles.fact}><p className={styles.factValue}>{ago(channel.lastEventAt)}</p><p className={styles.factLabel}>Last activity</p></div>
                </div>

                {channel.status === 'failing' && channel.lastDetail && <p className={styles.failure}>{channel.lastDetail}</p>}
                <div className={styles.cardActions}>
                  <button className={styles.checkButton} type="button" onClick={() => void checkOne(channel.id)} disabled={busy}>
                    {busy ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}{busy ? 'Checking…' : 'Run connection check'}
                  </button>
                  <span className={styles.lastCheck}>Inbound {ago(channel.lastInboundAt)} · Outbound {ago(channel.lastOutboundAt)}</span>
                </div>

                {channel.events.length > 0 && <details className={styles.events}>
                  <summary>Recent activity ({channel.events.length})</summary>
                  {channel.events.map((event) => (
                    <div className={styles.event} key={event.id}>
                      {event.outcome === 'success' ? <CheckCircle2 className={styles.eventIcon} size={14} color="var(--success)" /> : <CircleAlert className={styles.eventIcon} size={14} color="var(--danger)" />}
                      <div><p className={styles.eventStage}>{stageLabel(event.stage)} · {event.direction}</p>{event.detail && <p className={styles.eventDetail}>{event.detail}</p>}</div>
                      <time className={styles.eventTime}>{ago(event.occurredAt)}</time>
                    </div>
                  ))}
                </details>}
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
