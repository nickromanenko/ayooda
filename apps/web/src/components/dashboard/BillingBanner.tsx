'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiRequest } from '@/lib/api'

export function BillingBanner() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiRequest('/billing')
        if (!res.ok) return
        const d = await res.json() as { entitled: boolean; subscription: { status: string; trialEndsAt: string | null } | null }
        if (!d.entitled) { setMsg('Service is paused — choose a plan to continue.'); return }
        const t = d.subscription
        if (t?.status === 'trialing' && t.trialEndsAt) {
          const days = Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86400000)
          if (days <= 3) setMsg(`Your free trial ends in ${days} day${days === 1 ? '' : 's'}. Choose a plan to keep your agent live.`)
        }
      } catch { /* ignore */ }
    })()
  }, [])
  if (!msg) return null
  return (
    <Link href="/dashboard/billing" style={{ display: 'block', padding: '12px 16px', borderRadius: 'var(--r-md)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--ink)', fontSize: 13, marginBottom: 20, textDecoration: 'none' }}>
      {msg} <span style={{ color: 'var(--accent)' }}>Go to billing →</span>
    </Link>
  )
}
