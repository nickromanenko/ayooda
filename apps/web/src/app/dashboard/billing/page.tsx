'use client'

import { useState, useEffect, useCallback, type ComponentType, type CSSProperties } from 'react'
import { Check, Sparkles, Zap, Rocket, ArrowRight, CreditCard } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { trackProductEvent } from '@/lib/product-analytics'
import { Loading } from '@/components/dashboard/Loading'
import { Notice, PageHeader } from '@/components/dashboard/DashboardPrimitives'
import { CountUp, StatusPill } from '@/components/dashboard/kit'

interface PlanDef { tier: string; name: string; priceUsd: number; conversationCap: number }
interface BillingData {
  subscription: { status: string; tier: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null } | null
  usage: { periodConversationCount: number }
  entitled: boolean; reason: string; tier: string | null
  includedCap: number; ceiling: number; overageCount: number; estOverageUsd: number
  plans: PlanDef[]
}

type TierViz = {
  Icon: ComponentType<{ size?: number; color?: string }>; featured?: boolean; blurb: string
}

const TIER_VIZ: Record<string, TierViz> = {
  lite: { Icon: Sparkles, blurb: 'For getting started' },
  core: { Icon: Zap, featured: true, blurb: 'For growing teams' },
  max: { Icon: Rocket, blurb: 'For scaling support' },
}
const vizFor = (tier: string | null | undefined): TierViz => (tier && TIER_VIZ[tier]) || TIER_VIZ.core

const eyebrow: CSSProperties = { fontSize: 13, fontWeight: 510, color: 'var(--ink-mute)' }
const iconTile: CSSProperties = { display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: 'var(--r-sm)', background: 'var(--bg)', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1px var(--line-2)' }

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
      trackProductEvent('Checkout Completed', {})
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
      trackProductEvent('Checkout Started', { tier })
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
        <div style={{ padding: '40px 28px', textAlign: 'center', background: 'var(--panel)', boxShadow: 'var(--shadow-card)', borderRadius: 'var(--r-md)' }}>
          <p style={{ fontSize: 16, color: 'var(--ink)', fontFamily: 'var(--font-display)', margin: 0 }}>We couldn’t load your billing.</p>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '8px 0 20px' }}>This is usually momentary. Give it another try.</p>
          <button type="button" className="btn btn-primary"
            onClick={() => { setLoading(true); setLoadError(false); void load() }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const sub = data.subscription
  const ActiveIcon = vizFor(sub?.tier).Icon
  const pct = data.includedCap > 0 ? Math.min(100, Math.round((data.usage.periodConversationCount / data.includedCap) * 100)) : 0
  const trialLeft = sub?.status === 'trialing' && sub.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null
  const currentPlanName = sub?.tier ? data.plans.find((p) => p.tier === sub.tier)?.name : null

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <PageHeader title="Your plan & usage" description="Review plan status, included conversations, and projected overage costs." />

      {justPaid && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--r-md)', background: 'color-mix(in srgb, var(--success) 10%, var(--panel))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent)', marginBottom: 20 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Check size={13} color="#08090a" strokeWidth={3} /></span>
          <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
            Payment received{currentPlanName ? ` — you’re on the ${currentPlanName} plan.` : ' — activating your plan…'}
          </span>
        </div>
      )}

      {error && <Notice title="Billing action failed">{error}</Notice>}

      {/* Current status */}
      <div style={{ borderRadius: 'var(--r-md)', background: 'var(--panel)', padding: '24px', marginBottom: 28, boxShadow: 'var(--shadow-card)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ ...iconTile, width: 44, height: 44 }}>
            <ActiveIcon size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>Current plan</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              <span className="display" style={{ fontSize: 26 }}>
                {currentPlanName ?? (trialLeft !== null ? 'Free trial' : 'No plan')}
              </span>
              {trialLeft !== null && <StatusPill tone="lime">{trialLeft} day{trialLeft === 1 ? '' : 's'} left</StatusPill>}
              {sub?.status === 'past_due' && <StatusPill tone="red">Payment past due</StatusPill>}
              {!data.entitled && <StatusPill tone="red">Service paused</StatusPill>}
            </div>
          </div>
          {sub?.tier && (
            <button type="button" onClick={() => void manage()} disabled={busy === 'manage'} className="btn btn-ghost" style={{ flexShrink: 0 }}>
              <CreditCard size={14} /> {busy === 'manage' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>

        {/* Usage */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 8 }}>
            <span>Included conversations this period</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}><CountUp value={data.usage.periodConversationCount} /> / {data.includedCap.toLocaleString()} · {pct}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: pct >= 100 ? 'var(--danger)' : 'var(--accent)', transition: 'width .6s cubic-bezier(.2,0,0,1)' }} />
          </div>
          {data.overageCount > 0 && (
            <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 10 }}>
              {data.overageCount.toLocaleString()} over your plan, an estimated <strong style={{ color: 'var(--ink)', fontWeight: 510 }}>${data.estOverageUsd.toFixed(2)}</strong> this period ($0.05 each).
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
              position: 'relative', borderRadius: 'var(--r-md)', padding: '22px',
              background: 'var(--panel)', display: 'flex', flexDirection: 'column',
              boxShadow: current
                ? 'inset 0 0 0 1px var(--ink-dim)'
                : viz.featured ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)' : 'var(--shadow-card)',
            }}>
              {viz.featured && !current && (
                <span style={{ position: 'absolute', top: 18, right: 18 }}><StatusPill tone="lime">Most popular</StatusPill></span>
              )}
              <div style={{ ...iconTile, width: 38, height: 38, marginBottom: 14 }}>
                <viz.Icon size={18} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 510, color: 'var(--ink)', margin: 0 }}>{p.name}</p>
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '2px 0 0' }}>{viz.blurb}</p>
              <p style={{ margin: '14px 0 2px' }}>
                <span className="display" style={{ fontSize: 34 }}>${p.priceUsd}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}> / mo</span>
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 7, margin: '10px 0 18px' }}>
                <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                {p.conversationCap.toLocaleString()} conversations / month
              </p>
              <button type="button" onClick={() => void upgrade(p.tier)} disabled={busy === p.tier || current}
                className={current ? 'btn btn-ghost' : viz.featured ? 'btn btn-primary' : 'btn btn-ghost'}
                style={{ marginTop: 'auto', width: '100%', justifyContent: 'center', opacity: current ? 0.7 : 1 }}>
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
