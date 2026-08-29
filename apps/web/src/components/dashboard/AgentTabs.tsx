'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import type { AgentDoc } from '@ayooda/shared'
import { apiRequest } from '@/lib/api'
import AgentAvatar from './AgentAvatar'

/**
 * The agent is the container for everything that configures it, so the tab bar
 * — not the sidebar — is where knowledge, skills, tools, escalation and deploy
 * are reached. Which agent we mean comes from the URL, which is why none of
 * these screens needs an agent picker of its own.
 */
const TABS = [
  { slug: '', label: 'Info' },
  { slug: 'knowledge', label: 'Knowledge' },
  { slug: 'skills', label: 'Skills' },
  { slug: 'tools', label: 'Tools' },
  { slug: 'mcp', label: 'MCP' },
  { slug: 'escalation', label: 'Workflows' },
  { slug: 'test', label: 'Test' },
  { slug: 'deploy', label: 'Deploy' },
  { slug: 'usage', label: 'Usage' },
  { slug: 'security', label: 'Security' },
] as const

export default function AgentTabs({ agentId }: { agentId: string }) {
  const pathname = usePathname()
  const [agent, setAgent] = useState<AgentDoc | null>(null)
  const [missing, setMissing] = useState(false)
  const activeTabRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void apiRequest(`/agents/${agentId}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) setAgent(await res.json() as AgentDoc)
        else setMissing(true)
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [agentId])

  const base = `/dashboard/agents/${agentId}`
  const active = (slug: string) => {
    const href = slug ? `${base}/${slug}` : base
    return slug ? pathname.startsWith(href) : pathname === base
  }

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  return (
    <div style={{ marginBottom: 24 }}>
      <Link
        href="/dashboard/agents"
        className="agent-back-link"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-mute)', textDecoration: 'none', marginBottom: 14 }}
      >
        <ArrowLeft size={13} /> All agents
      </Link>

      <div className="agent-heading" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        {agent ? (
          <>
            <AgentAvatar name={agent.name} photoURL={agent.photoURL} seed={agent.id} size={40} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                {agent.name}
                {agent.isDefault && <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', marginLeft: 8 }}>· default</span>}
              </h1>
              <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.description || agent.llmModel}
              </p>
            </div>
          </>
        ) : missing ? (
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', margin: 0, fontFamily: 'var(--font-display)' }}>Agent not found</h1>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading agent…
          </p>
        )}
      </div>

      <div className="agent-tabs-wrap">
      <nav className="agent-tabs-nav" aria-label="Agent settings" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', overflowX: 'auto', scrollBehavior: 'smooth' }}>
        {TABS.map((t) => {
          const on = active(t.slug)
          return (
            <Link
              ref={on ? activeTabRef : undefined}
              key={t.slug || 'info'}
              href={t.slug ? `${base}/${t.slug}` : base}
              className="agent-tab-link"
              aria-current={on ? 'page' : undefined}
              style={{
                padding: '9px 14px',
                fontSize: 13.5,
                fontWeight: on ? 500 : 400,
                color: on ? 'var(--ink)' : 'var(--ink-mute)',
                textDecoration: 'none',
                borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      </div>
    </div>
  )
}
