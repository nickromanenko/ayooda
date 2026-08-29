'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, ChevronRight } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { AgentDoc } from '@ayooda/shared'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import NewAgentForm from '@/components/dashboard/NewAgentForm'
import { EmptyState, Loading } from '@/components/dashboard/Loading'
import { Notice, PageHeader } from '@/components/dashboard/DashboardPrimitives'
import { card, label } from '@/components/dashboard/ui'

export default function AgentsPage() {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await apiRequest('/agents')
      if (!res.ok) throw new Error('Could not load your agents.')
      const d = await res.json() as { agents: AgentDoc[] }
      setAgents(d.agents)
    } catch {
      setLoadError('Your agents could not be loaded. Your existing agents have not been changed.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  function handleCreated(agent: AgentDoc, warning?: string) {
    setShowNew(false)
    setNotice(warning ?? '')
    router.push(`/dashboard/agents/${agent.id}`)
  }

  if (loading) {
    return <Loading />
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        title="Agents"
        description="Open an agent to set its persona, knowledge, tools, escalation rules and where it’s deployed."
        action={!showNew && (
          <button type="button" onClick={() => { setShowNew(true); setNotice('') }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 'var(--r-sm)', padding: '10px 16px', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <Plus size={14} /> New agent
          </button>
        )}
      />

      {loadError && <Notice title="Agents unavailable" action={<button type="button" className="btn btn-ghost" onClick={() => void load()}>Retry</button>}>{loadError}</Notice>}

      {notice && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>{notice}</p>}

      {showNew && <NewAgentForm onCreated={handleCreated} onCancel={() => setShowNew(false)} />}

      {!showNew && !loadError && (
        <div style={card}>
          <p style={label}>Your agents</p>
          {agents.length === 0 && <EmptyState title="No agents yet" hint="Create your first agent to start adding knowledge and deploying support channels." action={<button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> Create agent</button>} />}
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/agents/${a.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', textDecoration: 'none' }}
            >
              <AgentAvatar name={a.name} photoURL={a.photoURL} seed={a.id} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>
                  {a.name}
                  {a.isDefault && <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}> · default</span>}
                </p>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.description || a.llmModel}
                </p>
              </div>
              <ChevronRight size={15} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
