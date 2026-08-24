import { adminDb } from '../firebase-admin'
import { resolveAgentDoc } from '../agents/agent-helpers'
import type { StoredCustomEndpoint } from '../llm/custom-endpoint'

export type AgentRec = {
  id: string
  systemPrompt: string
  llmModel: string
  gatewayKey?: string
  customEndpoint?: StoredCustomEndpoint
  knowledgeNamespace: string
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash'

export function toAgentRec(
  id: string,
  d: FirebaseFirestore.DocumentData,
  workspaceId: string,
): AgentRec {
  return {
    id,
    systemPrompt: d.systemPrompt ?? '',
    llmModel: d.llmModel ?? DEFAULT_MODEL,
    gatewayKey: d.gatewayKey,
    ...(d.customEndpoint ? { customEndpoint: d.customEndpoint } : {}),
    knowledgeNamespace: d.knowledgeNamespace ?? `ws_${workspaceId}`,
  }
}

/** Pre-migration safety net: workspaces whose agent still lives inline on the workspace doc. */
export function inlineAgentRec(
  workspaceId: string,
  workspaceData: FirebaseFirestore.DocumentData,
): AgentRec {
  const inline = workspaceData.agent ?? {}
  return {
    id: 'inline',
    systemPrompt: inline.systemPrompt ?? '',
    llmModel: inline.llmModel ?? DEFAULT_MODEL,
    gatewayKey: workspaceData.gatewayKey,
    knowledgeNamespace: `ws_${workspaceId}`,
  }
}

/**
 * The requested agent, else the workspace default, else the inline fallback.
 * Never throws — a lookup failure degrades to the inline record so a turn can
 * still produce a reply.
 */
export async function resolveAgentRec(
  workspaceId: string,
  agentId: string | undefined,
  workspaceData: FirebaseFirestore.DocumentData,
): Promise<AgentRec> {
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  try {
    const [specificSnap, defaultSnap] = await Promise.all([
      agentId ? agentsCol.doc(agentId).get() : Promise.resolve(null),
      agentsCol.where('isDefault', '==', true).limit(1).get(),
    ])
    const byId = new Map<string, AgentRec>()
    if (specificSnap && specificSnap.exists) {
      const r = toAgentRec(specificSnap.id, specificSnap.data()!, workspaceId)
      byId.set(r.id, r)
    }
    const defaultAgent = defaultSnap.empty
      ? undefined
      : toAgentRec(defaultSnap.docs[0]!.id, defaultSnap.docs[0]!.data(), workspaceId)
    const resolved = resolveAgentDoc(agentId, byId, defaultAgent)
    if (resolved) return resolved
  } catch (err) {
    console.warn('[agent-turn] agent resolution failed:', err)
  }
  return inlineAgentRec(workspaceId, workspaceData)
}
