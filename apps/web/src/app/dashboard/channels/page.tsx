'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, BellRing, Bot, CheckCircle2, CircleAlert, Globe2, Loader2, Mail, MessageSquare, RefreshCw, Save, Smartphone } from 'lucide-react'
import { apiRequest, apiRequestOrThrow } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { Notice, PageHeader } from '@/components/dashboard/DashboardPrimitives'
import styles from './page.module.css'

type Status = 'healthy' | 'failing' | 'unchecked' | 'inactive'
interface ReliabilityEvent { id: string; direction: string; outcome: 'success' | 'failure'; stage: string; detail: string | null; occurredAt: string | null }
interface ChannelHealth {
  id: string; type: string; agentName: string; status: Status; successCount: number; failureCount: number; consecutiveFailures: number
  lastEventAt: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; lastFailureAt: string | null
  lastStage: string | null; lastDetail: string | null; events: ReliabilityEvent[]
  alertIncidentOpen: boolean; lastAlertKind: 'failure' | 'recovery' | null; lastAlertAt: string | null
  lastAlertDeliveryAt: string | null; lastAlertDeliveryStatus: 'delivered' | 'partial' | 'failed' | null; lastAlertDeliveryDetail: string | null
}
interface ReliabilityResponse { summary: { total: number; healthy: number; failing: number; unchecked: number }; channels: ChannelHealth[] }
interface AlertSettings {
  enabled: boolean; threshold: number
  email: { enabled: boolean; address: string; transportChannelId: string }
  slack: { enabled: boolean; destination: string; transportChannelId: string }
}
interface AlertTransport { id: string; label: string }
interface AlertSettingsResponse { settings: AlertSettings; transports: { email: AlertTransport[]; slack: AlertTransport[] } }

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
  const [loadError, setLoadError] = useState('')
  const [alerts, setAlerts] = useState<AlertSettingsResponse | null>(null)
  const [savingAlerts, setSavingAlerts] = useState(false)
  const [alertNotice, setAlertNotice] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const response = await apiRequest('/channels/reliability')
      const body = await response.json().catch(() => ({})) as ReliabilityResponse & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load channel health.')
      setData(body)
    } catch (caught) {
      setData(null)
      setLoadError(caught instanceof Error ? caught.message : 'Could not load channel health.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    try {
      const response = await apiRequest('/channels/reliability/alerts')
      const body = await response.json().catch(() => ({})) as AlertSettingsResponse & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not load alert settings.')
      setAlerts(body)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load alert settings.')
    }
  }, [])

  useEffect(() => { void Promise.all([load(), loadAlerts()]) }, [load, loadAlerts])

  function updateAlerts(update: (settings: AlertSettings) => AlertSettings) {
    setAlertNotice('')
    setAlerts((current) => current ? { ...current, settings: update(current.settings) } : current)
  }

  async function saveAlerts() {
    if (!alerts) return
    setSavingAlerts(true); setError(''); setAlertNotice('')
    try {
      const response = await apiRequest('/channels/reliability/alerts', { method: 'PUT', body: JSON.stringify(alerts.settings) })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not save alert settings.')
      setAlertNotice(alerts.settings.enabled ? 'Reliability alerts are active.' : 'Reliability alerts are paused.')
      await loadAlerts()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save alert settings.')
    } finally {
      setSavingAlerts(false)
    }
  }

  async function check(channelId: string) {
    setChecking((current) => new Set(current).add(channelId)); setError('')
    try {
      await apiRequestOrThrow(`/channels/${channelId}/diagnose`, { method: 'POST' }, 'Connection check failed.')
      await load()
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
  const summary = data?.summary

  return (
    <div className={styles.page}>
      <PageHeader title="Channel health" description="Check provider credentials, spot delivery failures, and inspect recent inbound and outbound activity across every deployed agent." action={<button className={styles.button} type="button" onClick={() => void checkAll()} disabled={!data?.channels.length || checking.size > 0}>
          {checking.size > 0 ? <Loader2 size={15} className={styles.spin} /> : <Activity size={15} />}
          {checking.size > 0 ? `Checking ${checking.size}…` : 'Run all checks'}
        </button>} />

      {loadError && <Notice title="Channel health unavailable" action={<button type="button" className="btn btn-ghost" onClick={() => { setLoading(true); void load() }}>Retry</button>}>We could not retrieve live channel status. Existing channels and deliveries are unaffected.</Notice>}
      {error && <Notice title="Action could not be completed">{error}</Notice>}

      {summary && <section className={styles.summary} aria-label="Channel health summary">
        {[['Connected', summary.total], ['Healthy', summary.healthy], ['Needs attention', summary.failing], ['Not checked', summary.unchecked]].map(([label, value]) => (
          <div className={styles.metric} key={String(label)}><p className={styles.metricValue}>{value}</p><p className={styles.metricLabel}>{label}</p></div>
        ))}
      </section>}

      {alerts && <section className={styles.alertPanel} aria-labelledby="alert-settings-title">
        <div className={styles.alertHeader}>
          <div className={styles.alertIdentity}>
            <span className={styles.alertIcon}><BellRing size={18} strokeWidth={1.7} /></span>
            <div><h2 id="alert-settings-title" className={styles.alertTitle}>Reliability alerts</h2><p className={styles.alertDescription}>Notify owners once when a channel reaches the failure threshold, then again when it recovers.</p></div>
          </div>
          <button
            className={`${styles.toggle} ${alerts.settings.enabled ? styles.toggleOn : ''}`}
            type="button" role="switch" aria-checked={alerts.settings.enabled}
            aria-label="Enable reliability alerts"
            onClick={() => updateAlerts((settings) => ({ ...settings, enabled: !settings.enabled }))}
          ><span className={styles.toggleKnob} /></button>
        </div>

        <div className={styles.alertForm} aria-disabled={!alerts.settings.enabled}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Alert after</span>
            <select className={styles.select} value={alerts.settings.threshold} disabled={!alerts.settings.enabled} onChange={(event) => updateAlerts((settings) => ({ ...settings, threshold: Number(event.target.value) }))}>
              {[2, 3, 4, 5, 6, 8, 10].map((threshold) => <option key={threshold} value={threshold}>{threshold} consecutive failures</option>)}
            </select>
          </label>

          <div className={styles.destination}>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={alerts.settings.email.enabled} disabled={!alerts.settings.enabled || alerts.transports.email.length === 0} onChange={(event) => updateAlerts((settings) => ({ ...settings, email: { ...settings.email, enabled: event.target.checked } }))} />
              <span><strong>Email owner</strong><small>{alerts.transports.email.length ? 'Send through a connected Resend mailbox.' : 'Connect an email channel to enable this.'}</small></span>
            </label>
            {alerts.settings.email.enabled && <div className={styles.destinationFields}>
              <label className={styles.field}><span className={styles.fieldLabel}>Recipient</span><input className={styles.input} type="email" value={alerts.settings.email.address} disabled={!alerts.settings.enabled} onChange={(event) => updateAlerts((settings) => ({ ...settings, email: { ...settings.email, address: event.target.value } }))} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Send with</span><select className={styles.select} value={alerts.settings.email.transportChannelId} disabled={!alerts.settings.enabled} onChange={(event) => updateAlerts((settings) => ({ ...settings, email: { ...settings.email, transportChannelId: event.target.value } }))}>{alerts.transports.email.map((channel) => <option key={channel.id} value={channel.id}>{channel.label}</option>)}</select></label>
            </div>}
          </div>

          <div className={styles.destination}>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={alerts.settings.slack.enabled} disabled={!alerts.settings.enabled || alerts.transports.slack.length === 0} onChange={(event) => updateAlerts((settings) => ({ ...settings, slack: { ...settings.slack, enabled: event.target.checked } }))} />
              <span><strong>Slack channel</strong><small>{alerts.transports.slack.length ? 'Send through a connected Slack app.' : 'Connect a Slack channel to enable this.'}</small></span>
            </label>
            {alerts.settings.slack.enabled && <div className={styles.destinationFields}>
              <label className={styles.field}><span className={styles.fieldLabel}>Channel ID</span><input className={styles.input} value={alerts.settings.slack.destination} disabled={!alerts.settings.enabled} placeholder="C0123456789" onChange={(event) => updateAlerts((settings) => ({ ...settings, slack: { ...settings.slack, destination: event.target.value } }))} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Send with</span><select className={styles.select} value={alerts.settings.slack.transportChannelId} disabled={!alerts.settings.enabled} onChange={(event) => updateAlerts((settings) => ({ ...settings, slack: { ...settings.slack, transportChannelId: event.target.value } }))}>{alerts.transports.slack.map((channel) => <option key={channel.id} value={channel.id}>{channel.label}</option>)}</select></label>
            </div>}
          </div>
        </div>

        <div className={styles.alertFooter}>
          <p className={styles.alertHint}>{alertNotice || 'One alert per incident. Alert delivery failures are recorded but not retried automatically.'}</p>
          <button className={styles.saveButton} type="button" disabled={savingAlerts} onClick={() => void saveAlerts()}>{savingAlerts ? <Loader2 size={14} className={styles.spin} /> : <Save size={14} />}{savingAlerts ? 'Saving…' : 'Save alerts'}</button>
        </div>
      </section>}

      {data && !data.channels.length ? <div className={styles.empty}><p>No channels are connected yet. Deploy an agent to start monitoring delivery health.</p><Link href="/dashboard/agents" className="btn btn-primary">Choose an agent to deploy</Link></div> : data ? (
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
                {channel.lastAlertAt && <p className={`${styles.alertDelivery} ${channel.lastAlertDeliveryStatus === 'failed' ? styles.alertDeliveryFailed : ''}`}>
                  {channel.lastAlertKind === 'recovery' ? 'Recovery alert' : 'Failure alert'} {channel.lastAlertDeliveryStatus ?? 'queued'} {ago(channel.lastAlertDeliveryAt ?? channel.lastAlertAt)}
                  {channel.lastAlertDeliveryDetail ? ` · ${channel.lastAlertDeliveryDetail}` : ''}
                </p>}
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
      ) : null}
    </div>
  )
}
