import { FieldValue } from 'firebase-admin/firestore'
import type { ToolSet } from 'ai'
import { adminDb } from '../firebase-admin'
import { LEGACY_MODEL_MAP } from '../gemini'
import { getLangfuse, type LangfuseTrace } from '../langfuse'
import { type ChatParams } from '../llm/chat'
import { type StoredTool } from './tools'
import { resolveAgentRuntime } from '../llm/resolve'
import { resolveAgentRec } from './agent-resolution'
import { retrieveContext } from './retrieval'
import { buildChatParams } from './prompt'
import { loadTurnTools } from './turn-tools'
import { evaluateWorkflow } from '../workflow/engine'
import { evaluateWorkflowGraph, validateWorkflowGraph } from '../workflow/graph'
import { type ChannelType, type PlanTier, type WorkflowRule } from '@ayooda/shared'
import { checkEntitlement, shouldResetPeriod, type GateReason } from '../billing/entitlement'
import { emitOverageEvent } from '../billing/overage'
import { loadEnabledSkills, type LoadedSkill } from '../skills/registry'
import { gatherContext } from '../skills/run'
import { elapsedMs, timestampDate } from '../analytics/timing'
import { knowledgeConfidence, LOW_KNOWLEDGE_CONFIDENCE, utcDateKey } from '../analytics/confidence'
import { sandboxSessionPath } from './sandbox-session'
import '../skills/all'

export interface PrepareTurnInput {
  workspaceId: string
  channelId: string
  conversationId: string
  visitorId: string
  message: string
  channelType: ChannelType | 'sandbox'
  telegramChatId?: number
  agentId?: string
  sandbox?: { ownerUid: string; allowTools: boolean }
}

export interface ReadyTurn {
  kind: 'ready'
  chatParams: ChatParams
  sources: Array<{ docId: string; source: string; score: number }>
  trace: LangfuseTrace
  llmModel: string
  tools: StoredTool[]
  skillTools: ToolSet
  mcpTools: ToolSet
  /** Exact workflow responses emitted before the generated response. */
  prefix: string
  persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
}

export type PreparedTurn =
  | { kind: 'gated'; reason: GateReason }
  | { kind: 'error'; error: string }
  | { kind: 'silent' }
  | {
      kind: 'workflow'
      action: WorkflowRule['action']['type']
      status: 'bot' | 'waiting' | 'human' | 'resolved'
      message: string
      messageId: string
      sources: Array<{ docId: string; source: string; score: number }>
    }
  | ReadyTurn

const DEFAULT_HANDOFF = 'Let me connect you with someone from our team.'
const DEFAULT_ASSIGNED = 'I’m connecting you with the right person on our team.'
const DEFAULT_ROUTED = 'I’m routing this conversation to the right specialist.'
const DEFAULT_RESOLVED = 'This conversation has been resolved. Send another message if you still need help.'

export type SilenceGate =
  | { kind: 'proceed' }
  | { kind: 'reopen'; update: Record<string, unknown> }
  | { kind: 'silent' }

/**
 * Decides what a non-`bot` conversation status means for this turn.
 *
 * A human owning or queueing the conversation (`assigned`/`waiting`, or `resolved` from the
 * inbox) still silences the bot — unchanged, long-standing behaviour. But a conversation the
 * idle sweep closed carries `autoClosedAt`: WE ended it, the visitor did not, and the widget
 * keeps the same conversationId in sessionStorage. Left silenced it would dead-end forever, so
 * reopen it and answer normally.
 *
 * The reopen clears everything describing the closed state. Dropping `postProcessedAt` and
 * `scoredAt` is deliberate: the conversation genuinely continued, so when it next closes its
 * score and summary should cover the whole thing, not just the part before the visitor returned.
 */
export function evaluateSilenceGate(data: FirebaseFirestore.DocumentData | undefined): SilenceGate {
  if (!data || !data.status || data.status === 'bot') return { kind: 'proceed' }
  if (!data.autoClosedAt) return { kind: 'silent' }
  return {
    kind: 'reopen',
    update: {
      status: 'bot',
      autoClosedAt: FieldValue.delete(),
      resolvedAt: FieldValue.delete(),
      resolutionMs: FieldValue.delete(),
      pendingPostProcess: FieldValue.delete(),
      postProcessedAt: FieldValue.delete(),
      scoredAt: FieldValue.delete(),
    },
  }
}

/**
 * Channel-agnostic agent turn: billing gate → conversation setup → RAG → model runtime resolution
 * → prompt + ChatParams, plus a persist() closure. The caller drives streamChat (SSE for the
 * widget, accumulate+sendMessage for Telegram) and calls persist() with the final reply.
 */
export async function prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn> {
  const turnStartedAt = new Date()
  const { workspaceId, channelId, conversationId, visitorId, message, channelType, telegramChatId, agentId, sandbox } = input
  const isSandbox = !!sandbox
  const trimmed = message.trim()

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)
  const workspaceSnap = await workspaceRef.get()
  if (!workspaceSnap.exists) return { kind: 'error', error: 'Workspace not found' }
  const workspaceData = workspaceSnap.data()!

  const convRef = adminDb.doc(isSandbox
    ? sandboxSessionPath(workspaceId, sandbox.ownerUid, conversationId)
    : `workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return { kind: 'error', error: 'Not found' }
  }
  // A workflow route persists on the conversation. Channel defaults only choose
  // the agent for a new thread; later turns stay with the routed specialist.
  const conversationAgentId = convSnap.data()?.agentId
  const effectiveAgentId = !isSandbox && typeof conversationAgentId === 'string' && conversationAgentId
    ? conversationAgentId
    : agentId
  const agentRec = await resolveAgentRec(workspaceId, effectiveAgentId, workspaceData)

  // Per-agent usage counters. resolveAgentRec falls back to a synthetic 'inline'
  // record for pre-migration workspaces with no agent doc — there is nothing to
  // write to then, so this is null and the increments are skipped. It must never
  // point at the workspace doc: that would double-count the workspace totals,
  // which are incremented separately just below.
  const agentUsageRef = isSandbox || agentRec.id === 'inline'
    ? null
    : adminDb.doc(`workspaces/${workspaceId}/agents/${agentRec.id}`)

  const systemPrompt: string = agentRec.systemPrompt
  const storedModel: string = agentRec.customEndpoint?.modelId ?? agentRec.llmModel ?? 'gemini-flash-latest'
  const llmModel: string = agentRec.customEndpoint ? storedModel : LEGACY_MODEL_MAP[storedModel] ?? storedModel

  let skills: LoadedSkill[] = []
  try {
    const tier = (workspaceData.subscription?.tier as PlanTier | null | undefined) ?? null
    skills = await loadEnabledSkills(workspaceId, agentRec.id, tier)
  } catch (err) {
    console.warn('[skills] load failed:', err)
  }

  const trace = getLangfuse().trace({
    name: isSandbox ? 'sandbox-chat' : 'agent-chat',
    sessionId: conversationId,
    userId: visitorId,
    input: { message: trimmed },
    metadata: { workspaceId, channelId, channelType, llmModel, ...(isSandbox ? { surface: 'sandbox' } : {}) },
  })

  const existingConversation = convSnap.data()
  const timingTracked = !convSnap.exists || !!existingConversation?.timingTrackedAt
  const conversationStartedAt = convSnap.exists ? timestampDate(existingConversation?.createdAt) : turnStartedAt

  // Silence guard: a conversation a human owns/queued never gets a bot reply.
  const gate = evaluateSilenceGate(convSnap.exists ? convSnap.data() : undefined)
  if (gate.kind === 'silent') {
    await convRef.collection('messages').add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })
    await convRef.update({
      updatedAt: FieldValue.serverTimestamp(), lastMessage: trimmed.slice(0, 200), lastMessageRole: 'user',
      ...(!isSandbox ? { unread: true, lastCustomerMessageAt: FieldValue.serverTimestamp() } : {}),
    })
    return { kind: 'silent' }
  }
  if (gate.kind === 'reopen') await convRef.update(gate.update)

  if (!convSnap.exists) {
    // Billing gate — only NEW conversations are gated.
    const rawSub = workspaceData.subscription
    const sub = rawSub
      ? {
          ...rawSub,
          trialEndsAt: rawSub.trialEndsAt?.toDate?.() ?? rawSub.trialEndsAt ?? null,
          currentPeriodEnd: rawSub.currentPeriodEnd?.toDate?.() ?? rawSub.currentPeriodEnd ?? null,
        }
      : undefined
    const usage = workspaceData.usage ?? {}
    const periodStart = usage.periodStart?.toDate?.() ?? null
    const reset = shouldResetPeriod(periodStart, new Date(), sub)
    const periodUsed = isSandbox ? 0 : reset ? 0 : (usage.periodConversationCount ?? 0)
    const ent = checkEntitlement({
      subscription: sub,
      periodConversationCount: periodUsed,
      workspaceCreatedAt: workspaceData.createdAt?.toDate?.() ?? new Date(0),
      now: new Date(),
    })
    if (!ent.entitled) return { kind: 'gated', reason: ent.reason }

    await convRef.set({
      channelId,
      channelType,
      agentId: agentRec.id,
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      timingTrackedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: trimmed,
      lastMessageRole: 'user',
      ...(!isSandbox ? { unread: true, lastCustomerMessageAt: FieldValue.serverTimestamp() } : {}),
      ...(isSandbox ? {
        sandbox: true,
        ownerUid: sandbox.ownerUid,
        allowTools: sandbox.allowTools,
        expiresAt: new Date(turnStartedAt.getTime() + 7 * 24 * 60 * 60_000),
      } : {}),
      ...(telegramChatId !== undefined ? { telegramChatId } : {}),
    })
    if (!isSandbox) {
      const update: Record<string, unknown> = { 'usage.conversationCount': FieldValue.increment(1) }
      if (reset) {
        // usage.periodStart is shared between this counter and Copilot's usage.copilotPeriodCount
        // (see routes/copilot.ts). Every writer that advances periodStart must reset BOTH counters,
        // or the other one compares its stale count against the fresh period and stays wrongly
        // gated for the rest of it. No Copilot thread was created by a customer conversation, hence 0.
        update['usage.periodConversationCount'] = 1
        update['usage.copilotPeriodCount'] = 0
        update['usage.periodStart'] = FieldValue.serverTimestamp()
      } else {
        update['usage.periodConversationCount'] = FieldValue.increment(1)
      }
      await workspaceRef.update(update)

      // Overage: this conversation is beyond the plan's included pack — meter it (non-fatal).
      if (ent.overage && (sub?.status === 'active' || sub?.status === 'past_due')) {
        void emitOverageEvent(sub?.stripeCustomerId, conversationId)
      }
    }
  } else if (isSandbox) {
    await convRef.update({
      allowTools: sandbox.allowTools,
      expiresAt: new Date(turnStartedAt.getTime() + 7 * 24 * 60 * 60_000),
    })
  }

  const messagesRef = convRef.collection('messages')
  await messagesRef.add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })
  if (convSnap.exists && !isSandbox) {
    await convRef.update({
      updatedAt: FieldValue.serverTimestamp(), lastMessage: trimmed.slice(0, 200), lastMessageRole: 'user',
      unread: true, lastCustomerMessageAt: FieldValue.serverTimestamp(),
    })
  }

  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(10).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  const { contextBlocks, sources } = await retrieveContext(agentRec.knowledgeNamespace, trimmed, trace)
  const responseConfidence = knowledgeConfidence(sources)
  const lowConfidence = responseConfidence < LOW_KNOWLEDGE_CONFIDENCE
  const confidenceConversationFields = (at: Date) => ({
    confidenceSum: FieldValue.increment(responseConfidence),
    confidenceSamples: FieldValue.increment(1),
    confidenceLowSamples: FieldValue.increment(lowConfidence ? 1 : 0),
    confidenceLatest: responseConfidence,
    confidenceUpdatedAt: at,
    ...(!existingConversation?.confidenceTrackedAt ? { confidenceTrackedAt: at } : {}),
  })
  const confidenceAgentFields = {
    'usage.confidenceSum': FieldValue.increment(responseConfidence),
    'usage.confidenceSamples': FieldValue.increment(1),
    'usage.confidenceLowSamples': FieldValue.increment(lowConfidence ? 1 : 0),
  }
  const recordConfidenceDay = async (at: Date) => {
    if (!agentUsageRef) return
    const date = utcDateKey(at)
    await agentUsageRef.collection('confidenceDaily').doc(date).set({
      date,
      confidenceSum: FieldValue.increment(responseConfidence),
      confidenceSamples: FieldValue.increment(1),
      confidenceLowSamples: FieldValue.increment(lowConfidence ? 1 : 0),
      updatedAt: at,
    }, { merge: true })
  }
  let workflowPrefix = ''

  // Skill context (non-fatal): each skill's contributeContext hook is isolated in gatherContext,
  // but guard the call itself too — belt and braces against gatherContext ever rejecting.
  const skillCtx = {
    workspaceId, agentId: agentRec.id, conversationId, visitorId,
    message: trimmed, config: {}, trace,
  }
  let skillBlocks: string[] = []
  try {
    if (skills.length) skillBlocks = await gatherContext(skills, skillCtx)
  } catch (err) {
    console.warn('[skills] gatherContext failed:', err)
  }

  // Workflow rules (non-fatal): evaluate after RAG so low-confidence is known.
  // Reply actions can continue into later rules or into the normal AI response;
  // all other actions terminate this turn with a deterministic outcome.
  try {
    const workflowContext = {
      messageLower: trimmed.toLowerCase(),
      botReplyCount: (convSnap.exists ? convSnap.data()!.botReplyCount : 0) ?? 0,
      sourceCount: sources.length,
      now: new Date(),
    }
    const graphSnap = await adminDb.doc(`workspaces/${workspaceId}/agents/${agentRec.id}/workflowGraph/main`).get()
    let hits: Array<Pick<WorkflowRule, 'id' | 'name' | 'action'>>
    let graphPath: string[] = []
    if (graphSnap.exists) {
      const parsed = validateWorkflowGraph(graphSnap.data())
      if (!parsed.ok) throw new Error(`Invalid stored workflow graph: ${parsed.error}`)
      const execution = evaluateWorkflowGraph(parsed.value, workflowContext)
      if (execution.truncated) throw new Error('Workflow graph execution reached its safety limit.')
      hits = execution.actions
      graphPath = execution.path
    } else {
      const rulesSnap = await adminDb.collection(`workspaces/${workspaceId}/agents/${agentRec.id}/workflowRules`).where('enabled', '==', true).get()
      const rules: WorkflowRule[] = rulesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkflowRule, 'id'>) }))
      hits = evaluateWorkflow(rules, workflowContext)
    }
    if (hits.length) {
      const replies = hits
        .filter((rule) => rule.action.type === 'reply')
        .map((rule) => rule.action.type === 'reply' ? rule.action.message.trim() : '')
        .filter(Boolean)
      const terminal = hits.at(-1)!

      if (terminal.action.type === 'reply' && terminal.action.continue) {
        workflowPrefix = replies.join('\n\n')
      } else {
        let status: 'bot' | 'waiting' | 'human' | 'resolved' = 'bot'
        let terminalMessage = ''
        const outcomeUpdate: Record<string, unknown> = {
          workflowRuleId: terminal.id,
          workflowRuleName: terminal.name,
          workflowAction: terminal.action.type,
        }
        switch (terminal.action.type) {
          case 'reply':
            terminalMessage = terminal.action.message
            break
          case 'escalate':
            status = 'waiting'
            terminalMessage = terminal.action.handoffMessage?.trim() || DEFAULT_HANDOFF
            outcomeUpdate.escalationReason = terminal.name
            outcomeUpdate.operatorId = null
            break
          case 'assign_teammate':
            status = 'human'
            terminalMessage = terminal.action.message?.trim() || DEFAULT_ASSIGNED
            outcomeUpdate.escalationReason = terminal.name
            outcomeUpdate.operatorId = terminal.action.teammateUid
            break
          case 'route_agent':
            terminalMessage = terminal.action.message?.trim() || DEFAULT_ROUTED
            outcomeUpdate.agentId = terminal.action.agentId
            outcomeUpdate.routedFromAgentId = agentRec.id
            outcomeUpdate.routedAt = new Date()
            break
          case 'resolve': {
            status = 'resolved'
            terminalMessage = terminal.action.message?.trim() || DEFAULT_RESOLVED
            const resolvedAt = new Date()
            const resolutionMs = timingTracked ? elapsedMs(conversationStartedAt, resolvedAt) : null
            outcomeUpdate.operatorId = null
            outcomeUpdate.pendingPostProcess = true
            outcomeUpdate.autoClosedAt = FieldValue.delete()
            if (resolutionMs !== null) {
              outcomeUpdate.resolvedAt = resolvedAt
              outcomeUpdate.resolutionMs = resolutionMs
            }
            break
          }
        }

        const message = [...replies.slice(0, terminal.action.type === 'reply' ? -1 : undefined), terminalMessage]
          .filter(Boolean)
          .join('\n\n')
        const repliedAt = new Date()
        const firstReplyMs = timingTracked && typeof existingConversation?.firstReplyMs !== 'number'
          ? elapsedMs(conversationStartedAt, repliedAt)
          : null
        const workflowMessageRef = await messagesRef.add({
          role: 'assistant', content: message, createdAt: FieldValue.serverTimestamp(),
          metadata: {
            workflowAction: terminal.action.type,
            workflowStepIds: hits.map((rule) => rule.id),
            ...(graphPath.length ? { workflowGraphPath: graphPath } : {}),
            knowledgeConfidence: responseConfidence,
          },
        })
        await convRef.update({
          status,
          ...outcomeUpdate,
          updatedAt: FieldValue.serverTimestamp(), lastMessage: message.slice(0, 200), lastMessageRole: 'assistant',
          ...(status === 'bot' ? { botReplyCount: FieldValue.increment(1) } : {}),
          ...(firstReplyMs !== null ? { firstReplyAt: repliedAt, firstReplyMs } : {}),
          ...confidenceConversationFields(repliedAt),
        })
        if (!isSandbox) {
          await workspaceRef.update({ 'usage.messageCount': FieldValue.increment(2) }).catch(() => {})
          await agentUsageRef?.update({ 'usage.messageCount': FieldValue.increment(2), ...confidenceAgentFields }).catch(() => {})
          await recordConfidenceDay(repliedAt).catch(() => {})
        }
        trace.update({ output: { workflowAction: terminal.action.type, workflowSteps: hits.map((rule) => rule.name), ...(graphPath.length ? { workflowGraphPath: graphPath } : {}) } })
        return { kind: 'workflow', action: terminal.action.type, status, message, messageId: workflowMessageRef.id, sources }
      }
    }
  } catch (err) {
    console.warn('[agent-turn] workflow check failed:', err)
  }

  // Model runtime resolution
  let runtimeResult
  try {
    runtimeResult = resolveAgentRuntime(agentRec.gatewayKey, agentRec.customEndpoint)
  } catch (err) {
    console.error('[agent-turn] model runtime resolution failed:', err)
    return { kind: 'error', error: 'AI model configuration is unavailable' }
  }
  if (!runtimeResult.ok) return { kind: 'error', error: 'AI model configuration is unavailable' }

  const { tools, skillTools, mcpTools } = isSandbox && !sandbox.allowTools
    ? { tools: [], skillTools: {}, mcpTools: {} }
    : await loadTurnTools(workspaceId, agentRec.id, skills, skillCtx)

  const persist = async (reply: string, promptTokens: number, completionTokens: number): Promise<string> => {
    const repliedAt = new Date()
    const firstReplyMs = timingTracked && typeof existingConversation?.firstReplyMs !== 'number'
      ? elapsedMs(conversationStartedAt, repliedAt)
      : null
    const messageRef = await messagesRef.add({
      role: 'assistant',
      content: reply,
      createdAt: FieldValue.serverTimestamp(),
      metadata: { sources, llmModel, promptTokens, completionTokens, knowledgeConfidence: responseConfidence },
    })
    try {
      await convRef.update({
        updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200), lastMessageRole: 'assistant', botReplyCount: FieldValue.increment(1),
        ...(firstReplyMs !== null ? { firstReplyAt: repliedAt, firstReplyMs } : {}),
        ...confidenceConversationFields(repliedAt),
      })
      if (!isSandbox) {
        await workspaceRef.update({
          'usage.messageCount': FieldValue.increment(2),
          'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
        })
        // Same counters on the agent, so the Usage tab can attribute spend to the
        // agent that actually produced it rather than the workspace as a whole.
        await agentUsageRef?.update({
          'usage.messageCount': FieldValue.increment(2),
          'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
          ...confidenceAgentFields,
        })
        await recordConfidenceDay(repliedAt)
      }
    } catch (err) {
      console.warn('[agent-turn] post-reply bookkeeping failed:', err)
    }
    trace.update({ output: { message: reply, sources } })
    return messageRef.id
  }

  return {
    kind: 'ready',
    chatParams: buildChatParams({
      systemPrompt,
      contextBlocks,
      skillBlocks,
      history,
      message: trimmed,
      runtime: runtimeResult.runtime,
      model: llmModel,
    }),
    sources,
    trace,
    llmModel,
    tools,
    skillTools,
    mcpTools,
    prefix: workflowPrefix,
    persist,
  }
}
