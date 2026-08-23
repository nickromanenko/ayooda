import type { ToolSet } from 'ai'
import { loadTools as defaultLoadTools, type StoredTool } from './tools'
import { gatherTools as defaultGatherTools } from '../skills/run'
import { loadMcpTools as defaultLoadMcpTools } from '../mcp/tools'
import type { LoadedSkill } from '../skills/registry'
import type { SkillContext } from '../skills/types'

export interface TurnToolsDeps {
  loadTools: (workspaceId: string, agentId: string) => Promise<StoredTool[]>
  gatherTools: (skills: LoadedSkill[], ctx: SkillContext<unknown>) => Promise<ToolSet>
  loadMcpTools: (workspaceId: string, agentId: string) => Promise<ToolSet>
}

const defaultDeps: TurnToolsDeps = {
  loadTools: defaultLoadTools,
  gatherTools: defaultGatherTools,
  loadMcpTools: defaultLoadMcpTools,
}

/**
 * Customer tools, skill tools, and MCP-server tools, each independently
 * non-fatal: one source failing must not cost the turn the others' tools.
 */
export async function loadTurnTools(
  workspaceId: string,
  agentId: string,
  skills: LoadedSkill[],
  skillCtx: SkillContext<unknown>,
  deps: TurnToolsDeps = defaultDeps,
): Promise<{ tools: StoredTool[]; skillTools: ToolSet; mcpTools: ToolSet }> {
  let tools: StoredTool[] = []
  try {
    tools = await deps.loadTools(workspaceId, agentId)
  } catch (err) {
    console.warn('[agent-turn] tool load failed:', err)
  }

  // No `skills.length` guard here: gatherTools already no-ops on an empty array
  // (see skills/run.ts), so calling it unconditionally is behaviour-identical
  // and keeps this a single DI seam for tests.
  let skillTools: ToolSet = {}
  try {
    skillTools = await deps.gatherTools(skills, skillCtx)
  } catch (err) {
    console.warn('[skills] gatherTools failed:', err)
  }

  let mcpTools: ToolSet = {}
  try {
    mcpTools = await deps.loadMcpTools(workspaceId, agentId)
  } catch (err) {
    console.warn('[mcp] loadMcpTools failed:', err)
  }

  return { tools, skillTools, mcpTools }
}
