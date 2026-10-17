'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import type { AgentDoc } from '@ayooda/shared'
import AgentAvatar from '@/components/dashboard/AgentAvatar'
import NewAgentForm from '@/components/dashboard/NewAgentForm'
import { EmptyState, Loading } from '@/components/dashboard/Loading'
import { Notice, PageHeader } from '@/components/dashboard/DashboardPrimitives'
import { Chip, ListRow, Panel } from '@/components/dashboard/kit'

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
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <PageHeader
        title="Agents"
        description="Open an agent to set its persona, knowledge, tools, escalation rules and where it’s deployed."
        action={!showNew && (
          <button type="button" onClick={() => { setShowNew(true); setNotice('') }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <Plus size={14} /> New agent
          </button>
        )}
      />

      {loadError && <Notice title="Agents unavailable" action={<button type="button" className="btn btn-ghost" onClick={() => void load()}>Retry</button>}>{loadError}</Notice>}

      {notice && <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 12 }}>{notice}</p>}

      {showNew && <NewAgentForm onCreated={handleCreated} onCancel={() => setShowNew(false)} />}

      {!showNew && !loadError && (
        <Panel title="Your agents" sub={agents.length ? `${agents.length} agent${agents.length === 1 ? '' : 's'}` : undefined}>
          {agents.length === 0 && <div style={{ padding: 18 }}><EmptyState title="No agents yet" hint="Create your first agent to start adding knowledge and deploying support channels." action={<button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} /> Create agent</button>} /></div>}
          {agents.map((a, i) => (
            <ListRow
              key={a.id}
              index={i}
              href={`/dashboard/agents/${a.id}`}
              lead={<AgentAvatar name={a.name} photoURL={a.photoURL} seed={a.id} size={36} />}
              title={<>{a.name}{a.isDefault && <Chip>default</Chip>}</>}
              sub={a.description || undefined}
              meta={<Chip>{a.llmModel}</Chip>}
            />
          ))}
        </Panel>
      )}
    </div>
  )
}
