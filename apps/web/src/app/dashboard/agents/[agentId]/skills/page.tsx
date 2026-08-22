'use client'

import { use } from 'react'
import AgentSkills from '@/components/dashboard/AgentSkills'

export default function AgentSkillsPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params)

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 0, marginBottom: 20 }}>
        Built-in abilities this agent can use during a conversation — remembering facts, searching the web, scoring its own answers.
      </p>
      <AgentSkills agentId={agentId} />
    </>
  )
}
