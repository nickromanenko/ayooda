/** Pinecone namespace for a freshly-created agent. Migrated default agents keep "ws_{workspaceId}". */
export function agentNamespace(workspaceId: string, agentId: string): string {
  return `ws_${workspaceId}_ag_${agentId}`
}

/** Pick the agent for a turn: the explicit id if known, else the default. */
export function resolveAgentDoc<T>(
  agentId: string | undefined,
  byId: Map<string, T>,
  defaultAgent: T | undefined,
): T | undefined {
  if (agentId) {
    const found = byId.get(agentId)
    if (found) return found
  }
  return defaultAgent
}

export function agentDeleteGuard(input: {
  isDefault: boolean
  isLast: boolean
  attachedChannels: string[]
}): { ok: true } | { ok: false; status: 400 | 409; error: string } {
  if (input.isDefault) return { ok: false, status: 400, error: 'Cannot delete the default agent. Set another agent as default first.' }
  if (input.isLast) return { ok: false, status: 400, error: 'Cannot delete the only agent.' }
  if (input.attachedChannels.length > 0) return { ok: false, status: 409, error: `Reassign these channels to another agent first: ${input.attachedChannels.join(', ')}` }
  return { ok: true }
}
