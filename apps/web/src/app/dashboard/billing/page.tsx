'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiRequest } from '@/lib/api'

interface PlanDef { tier: string; name: string; priceUsd: number; conversationCap: number }
interface BillingData {
  subscription: { status: string; tier: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null } | null
  usage: { periodConversationCount: number }
  entitled: boolean; reason: string; cap: number; tier: string | null
  plans: PlanDef[]
}

const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 20 }

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/billing')
      if (res.ok) setData(await res.json() as BillingData)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function upgrade(tier: string) {
    setBusy(tier)
    setError('')
    try {
      const res = await apiRequest('/billing/checkout', { method: 'POST', body: JSON.stringify({ tier }) })
      const body = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !body.url) { setError(body.error ?? 'Could not start checkout. Please try again.'); return }
      window.location.href = body.url
    } finally { setBusy('') }
  }
  async function manage() {
    setBusy('manage')
    setError('')
    try {
      const res = await apiRequest('/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (!res.ok || !body.url) { setError(body.error ?? 'Could not open the billing portal.'); return }
      window.location.href = body.url
    } finally { setBusy('') }
  }

  if (loading) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-mute)' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>
  if (!data) return <div style={{ padding: 24, color: '#f87171' }}>Failed to load billing.</div>

  const sub = data.subscription
  const pct = data.cap > 0 ? Math.min(100, Math.round((data.usage.periodConversationCount / data.cap) * 100)) : 0
  const trialLeft = sub?.status === 'trialing' && sub.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Billing</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Your plan and usage.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, marginBottom: 20 }}>{error}</div>
      )}

      {/* Current status */}
      <div style={card}>
        <p style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 12 }}>Current plan</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>
            {sub?.tier ? data.plans.find((p) => p.tier === sub.tier)?.name : trialLeft !== null ? 'Free trial' : 'No plan'}
          </span>
          {trialLeft !== null && <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{trialLeft} day{trialLeft === 1 ? '' : 's'} left</span>}
          {sub?.status === 'past_due' && <span style={{ fontSize: 13, color: '#f59e0b' }}>Payment past due</span>}
          {!data.entitled && <span style={{ fontSize: 13, color: '#f87171' }}>Service paused</span>}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>
            <span>Conversations this period</span><span>{data.usage.periodConversationCount} / {data.cap}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#f87171' : 'var(--accent)' }} />
          </div>
        </div>
        {sub?.tier && (
          <button type="button" onClick={() => void manage()} disabled={busy === 'manage'} className="btn btn-ghost" style={{ marginTop: 16, borderRadius: 'var(--r-sm)', padding: '8px 14px' }}>
            {busy === 'manage' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {/* Plans */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {data.plans.map((p) => {
          const current = sub?.tier === p.tier
          return (
            <div key={p.tier} style={{ ...card, marginBottom: 0, borderColor: current ? 'var(--accent)' : 'var(--line)' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</p>
              <p style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)', margin: '6px 0' }}>${p.priceUsd}<span style={{ fontSize: 13, color: 'var(--ink-mute)', fontWeight: 400 }}>/mo</span></p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{p.conversationCap.toLocaleString()} conversations / month</p>
              <button type="button" onClick={() => void upgrade(p.tier)} disabled={busy === p.tier || current} className="btn btn-primary" style={{ marginTop: 14, width: '100%', justifyContent: 'center', borderRadius: 'var(--r-sm)', opacity: current ? 0.5 : 1 }}>
                {current ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Check size={14} /> Current</span> : busy === p.tier ? 'Opening…' : 'Choose'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
