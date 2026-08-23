'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Copy, Check, Trash2, UserPlus } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { Loading } from '@/components/dashboard/Loading'
import { card, label, input as baseInput } from '@/components/dashboard/ui'

interface Member { uid: string; email: string; displayName: string; role: string }
interface Invite { email: string; createdAt: string | null }

// ui.ts's `input` is width:100%; inside the invite rows we want it to flex instead.
const input: React.CSSProperties = { ...baseInput, flex: 1, width: 'auto' }

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiRequest('/team')
      if (res.ok) { const d = await res.json() as { members: Member[]; invites: Invite[] }; setMembers(d.members); setInvites(d.invites) }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function invite() {
    if (!email.trim()) return
    setInviting(true); setError(''); setInviteLink('')
    try {
      const res = await apiRequest('/team/invite', { method: 'POST', body: JSON.stringify({ email: email.trim() }) })
      const d = await res.json().catch(() => ({})) as { inviteLink?: string; error?: string }
      if (!res.ok) { setError(d.error ?? 'Could not send invite'); return }
      setInviteLink(d.inviteLink ?? ''); setEmail(''); await load()
    } finally { setInviting(false) }
  }
  async function revoke(e: string) {
    setBusyId('invite:' + e)
    try { await apiRequest(`/team/invite/${encodeURIComponent(e)}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }
  async function remove(uid: string) {
    setBusyId('member:' + uid)
    try { await apiRequest(`/team/member/${uid}`, { method: 'DELETE' }); await load() } finally { setBusyId('') }
  }

  if (loading) return <Loading />

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>Team</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Invite teammates to help answer conversations.</p>
      </div>

      {/* Invite */}
      <div style={card}>
        <p style={label}>Invite a teammate</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} placeholder="teammate@company.com" style={input} />
          <button type="button" onClick={() => void invite()} disabled={inviting || !email.trim()} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 18px', opacity: inviting || !email.trim() ? 0.5 : 1 }}>
            <UserPlus size={14} /> {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{error}</p>}
        {inviteLink && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 6 }}>Share this link with them (they join when they sign up with the invited email):</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={inviteLink} style={{ ...input, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
              <button type="button" onClick={() => { void navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 14px' }}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Members */}
      <div style={card}>
        <p style={label}>Members</p>
        {members.map((m) => (
          <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{m.displayName || m.email}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>{m.email}</p>
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 9px', borderRadius: 20, background: 'var(--bg-2)', color: m.role === 'owner' ? 'var(--accent)' : 'var(--ink-mute)' }}>{m.role}</span>
            {m.role !== 'owner' && (
              <button type="button" onClick={() => void remove(m.uid)} disabled={busyId === 'member:' + m.uid} aria-label="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 6 }}>
                {busyId === 'member:' + m.uid ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={card}>
          <p style={label}>Pending invites</p>
          {invites.map((i) => (
            <div key={i.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-dim)' }}>{i.email}</span>
              <button type="button" onClick={() => void revoke(i.email)} disabled={busyId === 'invite:' + i.email} className="btn btn-ghost" style={{ borderRadius: 'var(--r-sm)', padding: '6px 12px', fontSize: 13, color: '#f87171' }}>
                {busyId === 'invite:' + i.email ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
