'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, ChevronDown, CircleDashed, Loader2, RefreshCw, Rocket, Sparkles } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import styles from './readiness.module.css'

type ReadinessItem = {
  id: string
  label: string
  description: string
  status: 'complete' | 'blocker' | 'recommended'
  detail: string
  href: string
  action: string
  required: boolean
}
type Readiness = {
  ready: boolean
  score: number
  blockers: number
  completed: number
  required: number
  items: ReadinessItem[]
}

export default function LaunchReadiness({ agentId, refreshKey }: { agentId: string; refreshKey: number }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiRequest(`/agents/${agentId}/readiness`)
      if (!response.ok) throw new Error('Could not check launch readiness.')
      const data = await response.json() as Readiness
      setReadiness(data)
      if (!data.ready) setExpanded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check launch readiness.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { void load() }, [load, refreshKey])

  if (loading && !readiness) {
    return <section className={styles.panel}><div className={styles.loading}><Loader2 size={15} className={styles.spin} />Checking launch readiness…</div></section>
  }
  if (!readiness) {
    return <section className={styles.panel}><div className={styles.failure}><AlertTriangle size={14} /><span>{error || 'Could not check launch readiness.'}</span><button type="button" onClick={() => void load()}>Try again</button></div></section>
  }

  return (
    <section className={styles.panel} data-ready={readiness.ready} aria-labelledby="launch-readiness-title">
      <header className={styles.header}>
        <span className={`${styles.heroIcon} ${readiness.ready ? styles.heroReady : styles.heroPending}`}>{readiness.ready ? <Rocket size={17} /> : <CircleDashed size={17} />}</span>
        <div className={styles.headerCopy}>
          <div className={styles.titleRow}><h2 id="launch-readiness-title">{readiness.ready ? 'Ready to launch' : 'Launch readiness'}</h2><span className={readiness.ready ? styles.readyBadge : styles.blockerBadge}>{readiness.ready ? <Check size={11} /> : <AlertTriangle size={11} />}{readiness.ready ? 'All required checks passed' : `${readiness.blockers} ${readiness.blockers === 1 ? 'blocker' : 'blockers'}`}</span></div>
          <p>{readiness.ready ? 'This agent has the essentials needed for customer traffic.' : 'Finish the required checks before directing customers to this agent.'}</p>
        </div>
        <div className={styles.score}><strong>{readiness.score}%</strong><span>{readiness.completed}/{readiness.required} required</span></div>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading} aria-label="Refresh launch readiness" title="Refresh checks">{loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}</button>
        <button type="button" className={styles.expand} onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-controls="launch-readiness-checks"><ChevronDown size={15} /></button>
      </header>
      <div className={styles.progress} aria-label={`${readiness.score}% launch ready`}><span style={{ width: `${readiness.score}%` }} /></div>

      {expanded && (
        <div id="launch-readiness-checks" className={styles.body}>
          {error && <p className={styles.inlineError}><AlertTriangle size={12} />{error}</p>}
          <div className={styles.checks}>
            {readiness.items.map((item) => (
              <article key={item.id} className={styles.item} data-status={item.status}>
                <span className={styles.itemIcon}>{item.status === 'complete' ? <Check size={13} /> : item.status === 'blocker' ? <AlertTriangle size={13} /> : <Sparkles size={13} />}</span>
                <div className={styles.itemCopy}><div><h3>{item.label}</h3>{!item.required && <span>Recommended</span>}</div><p>{item.description}</p><small>{item.detail}</small></div>
                <Link href={item.href}>{item.action} →</Link>
              </article>
            ))}
          </div>
          <p className={styles.note}>Readiness is guidance, not a deployment lock. Recheck after changing knowledge, tests, workflows, or channels.</p>
        </div>
      )}
    </section>
  )
}
