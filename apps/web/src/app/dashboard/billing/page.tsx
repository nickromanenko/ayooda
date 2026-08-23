'use client'

import { useState, useEffect, useCallback, type ComponentType, type CSSProperties } from 'react'
import { Check, Sparkles, Zap, Rocket, ArrowRight, CreditCard } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'

interface PlanDef { tier: string; name: string; priceUsd: number; conversationCap: number }
interface BillingData {
  subscription: { status: string; tier: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null } | null
  usage: { periodConversationCount: number }
  entitled: boolean; reason: string; tier: string | null
  includedCap: number; ceiling: number; overageCount: number; estOverageUsd: number
  plans: PlanDef[]
}

type TierViz = {
  gradient: string; gradientSoft: string; border: string; textColor: string
  Icon: ComponentType<{ size?: number; color?: string }>; featured?: boolean; blurb: string
}

const TIER_VIZ: Record<string, TierViz> = {
  lite: {
    gradient: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(96,165,250,0.12) 0%, transparent 70%)',
    border: '#60a5fa', textColor: '#fff', Icon: Sparkles, blurb: 'For getting started',
  },
  core: {
    gradient: 'linear-gradient(135deg, #f5a524 0%, #b45309 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(245,165,36,0.14) 0%, transparent 70%)',
    border: 'var(--accent)', textColor: '#1a0e08', Icon: Zap, featured: true, blurb: 'For growing teams',
  },
  max: {
    gradient: 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
    gradientSoft: 'linear-gradient(180deg, rgba(192,132,252,0.12) 0%, transparent 70%)',
    border: '#c084fc', textColor: '#fff', Icon: Rocket, blurb: 'For scaling support',
  },
}
const vizFor = (tier: string | null | undefined): TierViz => (tier && TIER_VIZ[tier]) || TIER_VIZ.core

const eyebrow: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-mute)' }

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const [justPaid, setJustPaid] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/billing')
      if (res.ok) { setData(await res.json() as BillingData); setLoadError(false) }
      else setLoadError(true)
    } catch {
      setLoadError(true)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Detect the Stripe checkout redirect, show a confirmation, and strip the query
  // param so a reload doesn't re-trigger it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') === 'success') {
      setJustPaid(true)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // The subscription is applied by the Stripe webhook, which can land a few
  // seconds after the redirect. Poll briefly so the new plan appears on its own.
  useEffect(() => {
    if (!justPaid) return
    let tries = 0
    const id = setInterval(() => {
      tries += 1
      void load()
      if (tries >= 5) clearInterval(id)
    }, 2500)
    return () => clearInterval(id)
  }, [justPaid, load])

  async function upgrade(tier: string) {
    setBusy(tier); setError('')
    try {
      const res = await apiRequest('/billing/checkout', { method: 'POST', body: JSON.stringify({ tier }) })
      const body = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !body.url) { setError(body.error ?? 'Could not start checkout. Please try again.'); return }
      window.location.href = body.url
    } catch { setError('Could not start checkout. Please try again.') }
    finally { setBusy('') }
  }
  async function manage() {
    setBusy('manage'); setError('')
    try {
      const res = await apiRequest('/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !body.url) { setError(body.error ?? 'Could not open the billing portal.'); return }
      window.location.href = body.url
    } catch { setError('Could not open the billing portal.') }
    finally { setBusy('') }
  }

  if (loading) {
    return <Loading label="Loading your billing…" pad="80px 0" size={22} />
  }
  if (loadError || !data) {
    return (
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ padding: '40px 28px', textAlign: 'center', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)' }}>
          <p style={{ fontSize: 16, color: 'var(--ink)', fontFamily: 'var(--font-display)', margin: 0 }}>We couldn’t load your billing.</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '8px 0 20px' }}>This is usually momentary. Give it another try.</p>
          <button type="button" className="btn btn-primary" style={{ borderRadius: 999 }}
            onClick={() => { setLoading(true); setLoadError(false); void load() }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const sub = data.subscription
  const activeViz = vizFor(sub?.tier)
  const pct = data.includedCap > 0 ? Math.min(100, Math.round((data.usage.periodConversationCount / data.includedCap) * 100)) : 0
  const trialLeft = sub?.status === 'trialing' && sub.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null
  const currentPlanName = sub?.tier ? data.plans.find((p) => p.tier === sub.tier)?.name : null

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={eyebrow}><span style={{ color: 'var(--accent)' }}>◆</span>{'  '}Billing</div>
        <h1 className="display" style={{ fontSize: 32, margin: '10px 0 0' }}>Your plan &amp; usage</h1>
      </div>

      {justPaid && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--r-md)', background: 'rgba(139,227,181,0.10)', border: '1px solid rgba(139,227,181,0.3)', marginBottom: 20 }}>
          <span style={{ width: 26, height: 26, borderRadius: 50, background: 'var(--mint)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Check size={15} color="#0b0c10" /></span>
          <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
            Payment received{currentPlanName ? ` — you’re on the ${currentPlanName} plan.` : ' — activating your plan…'}
          </span>
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>
      )}

      {/* Current status */}
      <div style={{
        borderRadius: 'var(--r-lg)', border: `1px solid ${sub?.tier ? activeViz.border : 'var(--line)'}`,
        background: `${activeViz.gradientSoft}, var(--panel)`, padding: '26px 26px 24px', marginBottom: 28,
        boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: activeViz.gradient, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <activeViz.Icon size={22} color={activeViz.textColor} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>Current plan</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
              <span className="display" style={{ fontSize: 26 }}>
                {currentPlanName ?? (trialLeft !== null ? 'Free trial' : 'No plan')}
              </span>
              {trialLeft !== null && <span className="pill" style={{ padding: '3px 10px', fontSize: 11.5 }}>{trialLeft} day{trialLeft === 1 ? '' : 's'} left</span>}
              {sub?.status === 'past_due' && <span className="pill" style={{ padding: '3px 10px', fontSize: 11.5, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}>Payment past due</span>}
              {!data.entitled && <span className="pill" style={{ padding: '3px 10px', fontSize: 11.5, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}>Service paused</span>}
            </div>
          </div>
          {sub?.tier && (
            <button type="button" onClick={() => void manage()} disabled={busy === 'manage'} className="btn btn-ghost" style={{ borderRadius: 999, padding: '9px 16px', flexShrink: 0 }}>
              <CreditCard size={14} /> {busy === 'manage' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>

        {/* Usage */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 8 }}>
            <span>Included conversations this period</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{data.usage.periodConversationCount.toLocaleString()} / {data.includedCap.toLocaleString()}</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'var(--bg-2)', overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#f87171' : activeViz.gradient, transition: 'width .4s ease' }} />
          </div>
          {data.overageCount > 0 && (
            <p style={{ fontSize: 13, color: 'var(--accent)', marginTop: 10 }}>
              {data.overageCount.toLocaleString()} over your plan — an estimated <strong>${data.estOverageUsd.toFixed(2)}</strong> this period ($0.05 each).
            </p>
          )}
        </div>
      </div>

      {/* Plans */}
      <div style={{ ...eyebrow, marginBottom: 14 }}>{sub?.tier ? 'Change plan' : 'Choose a plan'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {data.plans.map((p) => {
          const viz = vizFor(p.tier)
          const current = sub?.tier === p.tier
          return (
            <div key={p.tier} style={{
              position: 'relative', borderRadius: 'var(--r-lg)', padding: '24px 22px',
              border: `1px solid ${current ? viz.border : 'var(--line)'}`,
              background: `${viz.gradientSoft}, var(--panel)`,
              display: 'flex', flexDirection: 'column',
              boxShadow: current ? `0 0 0 3px color-mix(in oklab, ${viz.border} 22%, transparent)` : 'none',
            }}>
              {viz.featured && !current && (
                <span style={{ position: 'absolute', top: -10, right: 16, padding: '3px 10px', borderRadius: 999, background: viz.gradient, color: viz.textColor, fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em' }}>MOST POPULAR</span>
              )}
              <div style={{ width: 40, height: 40, borderRadius: 11, background: viz.gradient, display: 'grid', placeItems: 'center', marginBottom: 14 }}>
                <viz.Icon size={20} color={viz.textColor} />
              </div>
              <p style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{p.name}</p>
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '2px 0 0' }}>{viz.blurb}</p>
              <p style={{ margin: '14px 0 2px' }}>
                <span className="display" style={{ fontSize: 34 }}>${p.priceUsd}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}> / mo</span>
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 7, margin: '10px 0 18px' }}>
                <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                {p.conversationCap.toLocaleString()} conversations / month
              </p>
              <button type="button" onClick={() => void upgrade(p.tier)} disabled={busy === p.tier || current}
                className={current ? 'btn btn-ghost' : 'btn btn-primary'}
                style={{ marginTop: 'auto', width: '100%', justifyContent: 'center', borderRadius: 999, opacity: current ? 0.7 : 1 }}>
                {current
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Check size={14} /> Current plan</span>
                  : busy === p.tier
                    ? 'Opening…'
                    : <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{sub?.tier ? 'Switch' : 'Choose'} <ArrowRight size={14} /></span>}
              </button>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 20, textAlign: 'center' }}>
        Plans include a monthly conversation allowance. Extra usage is billed at $0.05 per conversation.
      </p>
    </div>
  )
}
