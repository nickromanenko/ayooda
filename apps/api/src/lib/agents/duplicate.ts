export type DuplicateAgentInput = {
  name: string
  copyTools: boolean
  copySkills: boolean
  copyWorkflows: boolean
  copyTests: boolean
}

type WorkflowAction = { type?: unknown; agentId?: unknown; [key: string]: unknown }

function remapAction(action: unknown, sourceAgentId: string, targetAgentId: string): unknown {
  if (!action || typeof action !== 'object') return action
  const value = action as WorkflowAction
  return value.type === 'route_agent' && value.agentId === sourceAgentId ? { ...value, agentId: targetAgentId } : action
}

export function remapWorkflowAgentReferences(data: Record<string, unknown>, sourceAgentId: string, targetAgentId: string): Record<string, unknown> {
  return {
    ...data,
    ...(data.action ? { action: remapAction(data.action, sourceAgentId, targetAgentId) } : {}),
    ...(Array.isArray(data.nodes) ? {
      nodes: data.nodes.map((node) => {
        if (!node || typeof node !== 'object') return node
        const value = node as { action?: unknown }
        return value.action ? { ...value, action: remapAction(value.action, sourceAgentId, targetAgentId) } : node
      }),
    } : {}),
  }
}

function defaultCopyName(sourceName: string): string {
  const suffix = ' copy'
  return `${sourceName.slice(0, 80 - suffix.length).trimEnd()}${suffix}`
}

export function parseDuplicateAgentInput(raw: unknown, sourceName: string):
  | { ok: true; value: DuplicateAgentInput }
  | { ok: false; error: string } {
  if (raw !== undefined && raw !== null && typeof raw !== 'object') return { ok: false, error: 'Invalid request body.' }
  const body = (raw ?? {}) as Record<string, unknown>
  const name = body.name === undefined ? defaultCopyName(sourceName) : typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, error: 'Agent name is required.' }
  if (name.length > 80) return { ok: false, error: 'Agent name must be 80 characters or fewer.' }
  for (const key of ['copyTools', 'copySkills', 'copyWorkflows', 'copyTests'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false.` }
  }
  return {
    ok: true,
    value: {
      name,
      copyTools: body.copyTools !== false,
      copySkills: body.copySkills !== false,
      copyWorkflows: body.copyWorkflows !== false,
      copyTests: body.copyTests !== false,
    },
  }
}
