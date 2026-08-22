'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Lock } from 'lucide-react'
import type { AgentAccessEntry } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import { card, label, muted, errorText } from '@/components/dashboard/ui'

export default function AgentSecurityPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)
  const [people, setPeople] = useState<AgentAccessEntry[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    const res = await apiRequest(`/agents/${agentId}/access`)
    if (res.status === 403) { setForbidden(true); return }
    if (!res.ok) { setError('Could not load access for this agent.'); return }
    const d = await res.json() as { people: AgentAccessEntry[] }
    setPeople(d.people)
  }, [agentId])

  useEffect(() => { void load() }, [load])

  async function toggle(entry: AgentAccessEntry, next: boolean) {
    setBusy(entry.uid); setError('')
    try {
      const res = await apiRequest(`/agents/${agentId}/access/${entry.uid}`, {
        method: next ? 'PUT' : 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Could not change access.')
        return
      }
      await load()
    } finally { setBusy('') }
  }

  if (forbidden) {
    return (
      <p style={{ ...muted, margin: 0 }}>
        Only the workspace owner can manage who configures this agent.
      </p>
    )
  }
  if (!people && !error) {
    return <p style={{ ...muted, padding: '24px 0' }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</p>
  }

  const members = people?.filter((p) => !p.locked) ?? []

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Who can configure this agent — its prompt, knowledge, tools, escalation rules and deployment.
      </p>

      {error && <p style={{ ...errorText, marginBottom: 12 }}>{error}</p>}

      <div style={card}>
        <p style={label}>Access</p>

        {people?.filter((p) => p.locked).map((p) => (
          <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{p.displayName || p.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{p.email}</p>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-mute)' }}>
              <Lock size={11} /> owner
            </span>
          </div>
        ))}

        {members.length === 0 ? (
          <p style={{ ...muted, marginTop: 12, marginBottom: 0 }}>
            No other people in this workspace yet.{' '}
            <Link href="/dashboard/team" style={{ color: 'var(--accent)' }}>Invite someone →</Link>
          </p>
        ) : members.map((p) => (
          <label
            key={p.uid}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{p.displayName || p.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{p.email}</p>
            </div>
            {busy === p.uid
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--ink-mute)' }} />
              : <input
                  type="checkbox"
                  checked={p.hasAccess}
                  onChange={(e) => void toggle(p, e.target.checked)}
                  aria-label={`Let ${p.displayName || p.email} configure this agent`}
                />}
          </label>
        ))}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0 }}>
        Everyone in the workspace can see the Inbox and Copilot regardless. Creating, deleting and
        re-defaulting agents stays with the owner.
      </p>
    </>
  )
}
