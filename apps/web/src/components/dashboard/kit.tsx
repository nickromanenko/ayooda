'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import styles from './kit.module.css'

/** Counts a number up from zero on mount. Renders the final value without motion when the user prefers reduced motion. */
export function CountUp({ value, decimals = 0, suffix = '', duration = 900 }: { value: number; decimals?: number; suffix?: string; duration?: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = ms === 0 ? 1 : Math.min(1, (now - start) / ms)
      setShown(value * (1 - Math.pow(1 - p, 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <span className={styles.tabular}>{shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>
}

export function StatTile({ label, value, sub, icon, tone = 'neutral', index = 0 }: {
  label: string
  value: ReactNode
  sub?: string
  icon?: ReactNode
  tone?: 'neutral' | 'good'
  index?: number
}) {
  return (
    <div className={styles.tile} style={{ ['--i' as string]: index }}>
      <div className={styles.tileTop}>
        <span>{label}</span>
        {icon}
      </div>
      <b className={styles.tileValue}>{value}</b>
      {sub && <em className={styles.tileSub} data-tone={tone}>{sub}</em>}
    </div>
  )
}

export function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div><h2>{title}</h2>{sub && <span>{sub}</span>}</div>
        {action}
      </header>
      {children}
    </section>
  )
}

/** A linked row inside a Panel: title, one line of detail, optional leading visual and trailing meta. */
export function ListRow({ href, index = 0, lead, title, sub, meta, plain }: {
  href: string
  index?: number
  lead?: ReactNode
  title: ReactNode
  sub?: ReactNode
  meta?: ReactNode
  /** Regular-weight title, for rows whose title is customer text rather than a name. */
  plain?: boolean
}) {
  return (
    <Link href={href} className={styles.row} style={{ ['--i' as string]: index }}>
      {lead}
      <div className={styles.rowMain}>
        <p data-plain={plain}>{title}</p>
        {sub && <span>{sub}</span>}
      </div>
      {meta && <div className={styles.rowMeta}>{meta}</div>}
      <ChevronRight size={14} className={styles.chevron} aria-hidden />
    </Link>
  )
}

export type PillTone = 'lime' | 'green' | 'red' | 'blue' | 'neutral'

export function StatusPill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={styles.pill} data-tone={tone}>{children}</span>
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>
}

export type MessageSource = { docId: string; source: string; score: number }

function sourceLabel(source: string): string {
  try {
    const url = new URL(source)
    return (url.pathname === '/' ? url.hostname : url.pathname).replace(/\/$/, '')
  } catch {
    return source.split('/').pop() || source
  }
}

/** "How the agent answered": the sources behind a reply, with relevance scores. */
export function MessageSources({ sources, model, tokens }: { sources: MessageSource[]; model?: string; tokens?: number }) {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null
  const ranked = [...sources].sort((a, b) => b.score - a.score)
  return (
    <div className={styles.sources}>
      <button type="button" className={styles.sourcesToggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={styles.sourcesDot} aria-hidden />
        {ranked.length} source{ranked.length === 1 ? '' : 's'}
        <span className={styles.sourcesTop}>top match {Math.round(ranked[0]!.score * 100)}%</span>
      </button>
      {open && (
        <div className={styles.sourcesBody}>
          {ranked.map((s) => (
            <div key={`${s.docId}-${s.source}`} className={styles.score} title={s.source}>
              <span>{sourceLabel(s.source)}</span>
              <div className={styles.scoreTrack}><i style={{ width: `${Math.max(2, Math.min(100, s.score * 100))}%` }} /></div>
              <b>{s.score.toFixed(2)}</b>
            </div>
          ))}
          {(model || tokens) && <div className={styles.sourcesMeta}>{[model, tokens ? `${tokens.toLocaleString('en-US')} tokens` : null].filter(Boolean).join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
