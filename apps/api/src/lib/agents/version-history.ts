import type { DocumentData } from 'firebase-admin/firestore'

export const AGENT_CORE_FIELDS = ['name', 'description', 'systemPrompt', 'llmModel', 'role'] as const
export type AgentCoreField = typeof AGENT_CORE_FIELDS[number]

export type AgentCoreSnapshot = {
  name: string
  description: string
  systemPrompt: string
  llmModel: string
  role: string | null
}

export function agentCoreSnapshot(data: DocumentData): AgentCoreSnapshot {
  return {
    name: typeof data.name === 'string' ? data.name : '',
    description: typeof data.description === 'string' ? data.description : '',
    systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : '',
    llmModel: typeof data.llmModel === 'string' ? data.llmModel : '',
    role: typeof data.role === 'string' ? data.role : null,
  }
}

export function changedCoreFields(before: AgentCoreSnapshot, after: AgentCoreSnapshot): AgentCoreField[] {
  return AGENT_CORE_FIELDS.filter((field) => before[field] !== after[field])
}

export function isAgentCoreSnapshot(value: unknown): value is AgentCoreSnapshot {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.name === 'string'
    && typeof row.description === 'string'
    && typeof row.systemPrompt === 'string'
    && typeof row.llmModel === 'string'
    && (row.role === null || typeof row.role === 'string')
}
