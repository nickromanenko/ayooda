import type { ToolSet } from 'ai'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../firebase-admin'
import { getLangfuse, type LangfuseTrace } from '../langfuse'
import { LEGACY_MODEL_MAP } from '../gemini'
import { resolveGatewayKey } from '../llm/resolve'
import type { ChatParams } from '../llm/chat'
import { loadEnabledSkills, type LoadedSkill } from '../skills/registry'
import { gatherContext } from '../skills/run'
import '../skills/all'
import { resolveAgentRec } from './agent-resolution'
import { retrieveContext } from './retrieval'
import { buildChatParams } from './prompt'
import { loadTurnTools } from './turn-tools'
import type { StoredTool } from './tools'
import type { PlanTier } from '@ayooda/shared'

const HISTORY_WINDOW = 10

export interface PrepareCopilotTurnInput {
  workspaceId: string
  uid: string
  threadId: string
  agentId: string
  message: string
}

export interface ReadyCopilotTurn {
  kind: 'ready'
  chatParams: ChatParams
  sources: Array<{ docId: string; source: string; score: number }>
  tools: StoredTool[]
  skillTools: ToolSet
  /** The live Langfuse trace. The route passes it to runAgentTurn so tool-call
   *  spans attach to this turn instead of a throwaway trace. */
  trace: LangfuseTrace
  persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
}

export type PreparedCopilotTurn = ReadyCopilotTurn | { kind: 'error'; error: string }

/**
 * The one place Copilot's Firestore paths are built.
 *
 * The leaf collection is `threads` and must NEVER be named `conversations`:
 * lib/skills/sweep.ts runs two `collectionGroup('conversations')` queries that
 * auto-close and score whatever they match, workspace-wide. A rename here would
 * silently hand every member's private internal chats to that sweep. Guarded by
 * the path tests in ./copilot-turn.test.ts.
 */
export function copilotThreadsPath(workspaceId: string, uid: string): string {
  return `workspaces/${workspaceId}/copilotUsers/${uid}/threads`
}

export function copilotThreadPath(workspaceId: string, uid: string, threadId: string): string {
  return `${copilotThreadsPath(workspaceId, uid)}/${threadId}`
}

/**
 * Scoring exists to grade customer conversations for the owner; running it on
 * internal chats would pollute those metrics with staff traffic.
 */
/**
 * Copilot writes its own usage aggregates. `usage.messageCount` feeds the dashboard's
 * avgMessages (messageCount / conversationCount) and Copilot increments no
 * conversationCount, so sharing those fields would inflate a support metric with
 * internal chat.
 */
export const COPILOT_USAGE_FIELDS = {
  messageCount: 'usage.copilotMessageCount',
  tokenCount: 'usage.copilotTokenCount',
} as const

/** Two messages per turn (the user's and the assistant's), matching the channel path. */
export function copilotUsageDelta(
  promptTokens: number,
  completionTokens: number,
): { messages: number; tokens: number } {
  const safe = (n: number) => (Number.isFinite(n) ? n : 0)
  return { messages: 2, tokens: safe(promptTokens) + safe(completionTokens) }
}

export function skillsForCopilot(skills: LoadedSkill[]): LoadedSkill[] {
  return skills.filter((s) => s.def.id !== 'scoring')
}

export async function prepareCopilotTurn(
  input: PrepareCopilotTurnInput,
): Promise<PreparedCopilotTurn> {
  const { workspaceId, uid, threadId, agentId, message } = input
  const trimmed = message.trim()

  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!workspaceSnap.exists) return { kind: 'error', error: 'Workspace not found' }
  const workspaceData = workspaceSnap.data()!

  const agentRec = await resolveAgentRec(workspaceId, agentId, workspaceData)
  const storedModel = agentRec.llmModel
  const llmModel = LEGACY_MODEL_MAP[storedModel] ?? storedModel

  const trace = getLangfuse().trace({
    name: 'copilot-chat',
    sessionId: threadId,
    userId: uid,
    input: { message: trimmed },
    metadata: { workspaceId, agentId: agentRec.id, llmModel, surface: 'copilot' },
  })

  const threadRef = adminDb.doc(copilotThreadPath(workspaceId, uid, threadId))
  const messagesRef = threadRef.collection('messages')
  await messagesRef.add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })

  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(HISTORY_WINDOW).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  let skills: LoadedSkill[] = []
  try {
    const tier = (workspaceData.subscription?.tier as PlanTier | null | undefined) ?? null
    skills = skillsForCopilot(await loadEnabledSkills(workspaceId, agentRec.id, tier))
  } catch (err) {
    console.warn('[copilot] skill load failed:', err)
  }

  const { contextBlocks, sources } = await retrieveContext(agentRec.knowledgeNamespace, trimmed, trace)

  // The visitor identity for a Copilot turn is the team member, so per-visitor
  // Memory remembers facts about staff — which is the intent.
  const skillCtx = {
    workspaceId, agentId: agentRec.id, conversationId: threadId, visitorId: uid,
    message: trimmed, config: {}, trace,
  }
  let skillBlocks: string[] = []
  try {
    if (skills.length) skillBlocks = await gatherContext(skills, skillCtx)
  } catch (err) {
    console.warn('[copilot] gatherContext failed:', err)
  }

  let keyResult
  try {
    keyResult = resolveGatewayKey(agentRec.gatewayKey)
  } catch (err) {
    console.error('[copilot] key resolution failed:', err)
    return { kind: 'error', error: 'AI model needs an API key' }
  }
  if (!keyResult.ok) return { kind: 'error', error: 'AI model needs an API key' }

  const { tools, skillTools } = await loadTurnTools(workspaceId, agentRec.id, skills, skillCtx)

  const persist = async (
    reply: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<string> => {
    const ref = await messagesRef.add({
      role: 'assistant', content: reply, createdAt: FieldValue.serverTimestamp(),
      metadata: { sources, llmModel, promptTokens, completionTokens },
    })
    // Bookkeeping is best-effort: it must never cost the user their reply.
    try {
      const delta = copilotUsageDelta(promptTokens, completionTokens)
      await threadRef.set(
        { updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200) },
        { merge: true },
      )
      await adminDb.doc(`workspaces/${workspaceId}`).update({
        [COPILOT_USAGE_FIELDS.messageCount]: FieldValue.increment(delta.messages),
        [COPILOT_USAGE_FIELDS.tokenCount]: FieldValue.increment(delta.tokens),
      })
    } catch (err) {
      console.warn('[copilot] post-reply bookkeeping failed:', err)
    }
    trace.update({ output: { message: reply, sources } })
    return ref.id
  }

  return {
    kind: 'ready',
    chatParams: buildChatParams({
      systemPrompt: agentRec.systemPrompt,
      contextBlocks, skillBlocks, history,
      message: trimmed, apiKey: keyResult.apiKey, model: llmModel,
    }),
    sources, tools, skillTools, trace, persist,
  }
}
