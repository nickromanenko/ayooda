'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, MessageSquare, Zap, Coins, BookOpen, Star, Download, Clock3, Timer, Gauge } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, muted } from '@/components/dashboard/ui'

interface Usage {
  conversations: { total: number; thisPeriod: number | null; resolved: number; automated: number; handedOff: number; waiting: number }
  automationRate: number | null
  handoffs: { total: number; causes: Array<{ reason: string; count: number; percentage: number }> }
  timing: {
    firstReply: { averageMs: number | null; count: number }
    resolution: { averageMs: number | null; count: number }
  }
  confidence: {
    average: number | null
    lowRate: number | null
    count: number
    threshold: number
    trend: Array<{ date: string; average: number | null; count: number }>
  }
  csat: { average: number | null; count: number; distribution: [number, number, number, number, number] }
  messages: { count: number | null; tokens: number | null; trackedSince: string | null }
  knowledge: { docs: number; indexed: number; chunks: number }
  channels: string[]
  workspace: { periodConversations: number; includedCap: number; periodStart: string | null; tier: string | null }
}

const nf = new Intl.NumberFormat('en-US')
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtDuration = (ms: number | null) => {
  if (ms === null) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(ms < 36_000_000 ? 1 : 0)}h`
}

function Tile({ icon: Icon, accent, value, name, sub }: {
  icon: typeof MessageSquare; accent: string; value: string; name: string; sub?: string
}) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '16px 18px' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 9, marginBottom: 10, color: accent,
        background: `color-mix(in oklab, ${accent} 15%, transparent)`,
        border: `1px solid color-mix(in oklab, ${accent} 25%, transparent)`,
        display: 'grid', placeItems: 'center',
      }}>
        <Icon size={15} />
      </div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2 }}>{name}</p>
      {sub && <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>{sub}</p>}
    </div>
  )
}

/** A labelled proportion bar — used for both the resolution split and plan share. */
function Bar({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  if (total <= 0) return null
  return (
    <>
      <div style={{ display: 'flex', height: 8, borderRadius: 20, overflow: 'hidden', background: 'var(--bg-2)', marginBottom: 10 }}>
        {segments.map((s) => (
          s.value > 0 ? <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} /> : null
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-mute)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 50, background: s.color, flexShrink: 0 }} />
            {s.label}
            <strong style={{ color: 'var(--ink)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{nf.format(s.value)}</strong>
          </span>
        ))}
      </div>
    </>
  )
}

function ConfidenceTrend({ points, threshold }: { points: Usage['confidence']['trend']; threshold: number }) {
  return (
    <>
      <div style={{ height: 96, display: 'grid', gridTemplateColumns: `repeat(${points.length}, minmax(2px, 1fr))`, alignItems: 'end', gap: 3, marginTop: 16 }}>
        {points.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${point.average === null ? 'No samples' : `${point.average}% (${point.count})`}`}
            aria-label={`${point.date}: ${point.average === null ? 'no samples' : `${point.average}% confidence from ${point.count} responses`}`}
            style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
          >
            <div style={{
              width: '100%', minHeight: point.average === null ? 2 : 4,
              height: point.average === null ? 2 : `${point.average}%`, borderRadius: '3px 3px 1px 1px',
              background: point.average === null ? 'var(--line)' : point.average < threshold ? 'var(--accent)' : 'var(--mint)',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 6 }}>
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points.at(-1)?.date.slice(5)}</span>
      </div>
    </>
  )
}

export default function AgentUsagePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [u, setU] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void apiRequest(`/agents/${agentId}/usage`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) setU(await res.json() as Usage)
        else setError('Could not load usage for this agent.')
      })
      .catch(() => { if (!cancelled) setError('Could not load usage for this agent.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  async function exportCsv() {
    setExporting(true)
    try {
      const res = await apiRequest(`/agents/${agentId}/usage/export`)
      if (!res.ok) throw new Error('export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-${agentId}-conversations.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not export conversations.')
    } finally { setExporting(false) }
  }

  if (loading) {
    return <Loading />
  }
  if (!u) return <p style={{ ...muted, color: 'var(--danger)' }}>{error}</p>

  const c = u.conversations
  const unresolved = Math.max(0, c.total - c.resolved)
  const tokensTracked = u.messages.tokens !== null && u.messages.trackedSince !== null
  // thisPeriod is null when the agentId+createdAt index isn't available yet.
  // Say so rather than rendering a 0 that reads as a real measurement.
  const periodKnown = c.thisPeriod !== null
  const share = periodKnown && u.workspace.includedCap > 0
    ? Math.min(100, Math.round((c.thisPeriod! / u.workspace.includedCap) * 100))
    : null

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
          What this agent has handled, and what it&apos;s costing you.
        </p>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="btn btn-ghost"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '8px 14px', fontSize: 13, flexShrink: 0 }}
        >
          {exporting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
          Export CSV
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Tile
          icon={MessageSquare} accent="var(--blue)"
          value={nf.format(c.total)} name="Conversations"
          sub={c.thisPeriod !== null ? `${nf.format(c.thisPeriod)} this period` : undefined}
        />
        <Tile
          icon={Zap} accent="var(--mint)"
          value={u.automationRate !== null ? `${u.automationRate}%` : '—'}
          name="Automation rate"
          sub={u.automationRate !== null ? 'resolved without a human' : 'nothing resolved yet'}
        />
        <Tile
          icon={Star} accent="var(--accent)"
          value={u.csat.average !== null ? `${u.csat.average.toFixed(1)}` : '—'}
          name="Avg CSAT"
          sub={u.csat.count > 0 ? `${nf.format(u.csat.count)} scored` : 'nothing scored yet'}
        />
        <Tile
          icon={Coins} accent="var(--accent)"
          value={tokensTracked ? nf.format(u.messages.tokens!) : '—'}
          name="Tokens used"
          sub={tokensTracked ? `since ${fmtDate(u.messages.trackedSince!)}` : 'tracking not started'}
        />
        <Tile
          icon={BookOpen} accent="var(--accent)"
          value={nf.format(u.knowledge.indexed)} name="Knowledge docs"
          sub={`${nf.format(u.knowledge.chunks)} chunks`}
        />
        <Tile
          icon={Clock3} accent="var(--blue)"
          value={fmtDuration(u.timing.firstReply.averageMs)} name="Avg first reply"
          sub={u.timing.firstReply.count > 0 ? `${nf.format(u.timing.firstReply.count)} tracked` : 'tracking new conversations'}
        />
        <Tile
          icon={Timer} accent="var(--mint)"
          value={fmtDuration(u.timing.resolution.averageMs)} name="Avg resolution"
          sub={u.timing.resolution.count > 0 ? `${nf.format(u.timing.resolution.count)} tracked` : 'tracking new resolutions'}
        />
        <Tile
          icon={Gauge} accent="var(--mint)"
          value={u.confidence.average !== null ? `${u.confidence.average}%` : '—'} name="Knowledge confidence"
          sub={u.confidence.count > 0 ? `${nf.format(u.confidence.count)} responses` : 'tracking new responses'}
        />
      </div>

      {/* CSAT distribution */}
      {u.csat.count > 0 && (
        <div style={card}>
          <p style={label}>CSAT distribution</p>
          <Bar
            total={u.csat.count}
            segments={[5, 4, 3, 2, 1].map((score, i) => ({
              label: `${score}★`,
              value: u.csat.distribution[4 - i]!,
              color: score >= 4 ? 'var(--mint)' : score === 3 ? 'var(--accent)' : 'var(--line-2)',
            }))}
          />
        </div>
      )}

      {/* Retrieval evidence behind agent responses */}
      <div style={card}>
        <p style={label}>Knowledge confidence · last 30 days</p>
        {u.confidence.count === 0 ? (
          <p style={{ ...muted, margin: 0 }}>No confidence samples yet. New agent responses will appear here.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 23, color: 'var(--ink)', margin: 0 }}>{u.confidence.average}%</p>
                <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '2px 0 0' }}>average support</p>
              </div>
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 23, color: 'var(--ink)', margin: 0 }}>{u.confidence.lowRate}%</p>
                <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: '2px 0 0' }}>below {u.confidence.threshold}%</p>
              </div>
            </div>
            <ConfidenceTrend points={u.confidence.trend} threshold={u.confidence.threshold} />
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '10px 0 0' }}>
              Measures retrieval evidence supporting responses, not guaranteed answer correctness. Based on {nf.format(u.confidence.count)} response{u.confidence.count === 1 ? '' : 's'}.
            </p>
          </>
        )}
      </div>

      {/* How conversations ended */}
      <div style={card}>
        <p style={label}>How conversations ended</p>
        {c.total === 0 ? (
          <p style={{ ...muted, margin: 0 }}>
            No conversations yet. Once this agent is{' '}
            <Link href={`/dashboard/agents/${agentId}/deploy`} style={{ color: 'var(--accent-text)' }}>deployed</Link>
            {' '}and answering, its results appear here.
          </p>
        ) : (
          <Bar
            total={c.total}
            segments={[
              { label: 'Automated', value: c.automated, color: 'var(--mint)' },
              { label: 'Handed off', value: c.handedOff, color: 'var(--accent-text)' },
              { label: 'Still open', value: unresolved, color: 'var(--line-2)' },
            ]}
          />
        )}
        {c.waiting > 0 && (
          <p style={{ fontSize: 12, color: 'var(--accent-text)', marginTop: 12, marginBottom: 0 }}>
            {c.waiting} waiting on a human right now —{' '}
            <Link href="/dashboard/inbox" style={{ color: 'var(--accent-text)' }}>open the inbox</Link>
          </p>
        )}
      </div>

      {/* Why conversations needed a human */}
      <div style={card}>
        <p style={label}>Hand-off causes</p>
        {u.handoffs.total === 0 ? (
          <p style={{ ...muted, margin: 0 }}>No hand-offs recorded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {u.handoffs.causes.map((cause) => (
              <div key={cause.reason}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cause.reason}</span>
                  <span style={{ color: 'var(--ink-mute)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {nf.format(cause.count)} · {cause.percentage}%
                  </span>
                </div>
                <div style={{ height: 7, borderRadius: 20, overflow: 'hidden', background: 'var(--bg-2)' }}>
                  <div style={{ width: `${cause.percentage}%`, minWidth: cause.count > 0 ? 4 : 0, height: '100%', borderRadius: 20, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '2px 0 0' }}>
              Based on {nf.format(u.handoffs.total)} conversation{u.handoffs.total === 1 ? '' : 's'} escalated or taken over by a human.
            </p>
          </div>
        )}
      </div>

      {/* Share of the workspace plan */}
      <div style={card}>
        <p style={label}>Share of this period&apos;s plan</p>
        {u.workspace.includedCap > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {periodKnown ? nf.format(c.thisPeriod!) : '—'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
                of {nf.format(u.workspace.includedCap)} included conversations
                {share !== null && ` · ${share}%`}
              </span>
            </div>
            {periodKnown ? (
              <Bar
                total={u.workspace.includedCap}
                segments={[
                  { label: 'This agent', value: c.thisPeriod!, color: 'var(--accent-text)' },
                  {
                    label: 'Other agents',
                    value: Math.max(0, u.workspace.periodConversations - c.thisPeriod!),
                    color: 'var(--blue)',
                  },
                ]}
              />
            ) : (
              <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: 0 }}>
                This agent&apos;s share of the period isn&apos;t available yet — the database index
                it needs is still being created. The workspace has used{' '}
                {nf.format(u.workspace.periodConversations)} of {nf.format(u.workspace.includedCap)} so far.
              </p>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 12, marginBottom: 0 }}>
              The cap is shared across every agent in the workspace.{' '}
              <Link href="/dashboard/billing" style={{ color: 'var(--ink-mute)' }}>Manage plan →</Link>
            </p>
          </>
        ) : (
          <p style={{ ...muted, margin: 0 }}>
            No active plan.{' '}
            <Link href="/dashboard/billing" style={{ color: 'var(--accent-text)' }}>Choose one →</Link>
          </p>
        )}
      </div>

      {/* Messages — honest about when counting began */}
      <div style={card}>
        <p style={label}>Messages</p>
        {tokensTracked ? (
          <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', margin: 0 }}>
            <strong style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(u.messages.count ?? 0)}</strong> messages
            and <strong style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(u.messages.tokens ?? 0)}</strong> tokens
            since {fmtDate(u.messages.trackedSince!)}.
          </p>
        ) : (
          <p style={{ ...muted, margin: 0 }}>
            Per-agent message and token counting hasn&apos;t started for this agent yet. Conversation
            figures above cover its whole history and are unaffected.
          </p>
        )}
      </div>
    </>
  )
}
