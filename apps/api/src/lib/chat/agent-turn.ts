import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../firebase-admin'
import { embedText, LEGACY_MODEL_MAP } from '../gemini'
import { getLangfuse, type LangfuseTrace } from '../langfuse'
import { namespaceFor } from '../pinecone'
import { type ChatParams } from '../llm/openrouter'
import { loadTools, type StoredTool } from './tools'
import { resolveOpenRouterKey } from '../llm/resolve'
import { resolveAgentDoc } from '../agents/agent-helpers'
import { evaluateRules } from '../workflow/engine'
import { providerOf, type ChannelType, type WorkflowRule } from '@ayooda/shared'
import { checkEntitlement, shouldResetPeriod, type GateReason } from '../billing/entitlement'
import { emitOverageEvent } from '../billing/overage'

export interface PrepareTurnInput {
  workspaceId: string
  channelId: string
  conversationId: string
  visitorId: string
  message: string
  channelType: ChannelType
  telegramChatId?: number
  agentId?: string
}

export interface ReadyTurn {
  kind: 'ready'
  chatParams: ChatParams
  sources: Array<{ docId: string; source: string; score: number }>
  trace: LangfuseTrace
  llmModel: string
  tools: StoredTool[]
  persist: (reply: string, promptTokens: number, completionTokens: number) => Promise<string>
}

export type PreparedTurn =
  | { kind: 'gated'; reason: GateReason }
  | { kind: 'error'; error: string }
  | { kind: 'silent' }
  | { kind: 'escalated'; message: string }
  | ReadyTurn

const DEFAULT_HANDOFF = 'Let me connect you with someone from our team.'

/**
 * Channel-agnostic agent turn: billing gate → conversation setup → RAG → key resolution
 * → prompt + ChatParams, plus a persist() closure. The caller drives streamChat (SSE for the
 * widget, accumulate+sendMessage for Telegram) and calls persist() with the final reply.
 */
export async function prepareTurn(input: PrepareTurnInput): Promise<PreparedTurn> {
  const { workspaceId, channelId, conversationId, visitorId, message, channelType, telegramChatId, agentId } = input
  const trimmed = message.trim()

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)
  const workspaceSnap = await workspaceRef.get()
  if (!workspaceSnap.exists) return { kind: 'error', error: 'Workspace not found' }
  const workspaceData = workspaceSnap.data()!

  // Resolve the agent for this turn: the channel's agent, else the workspace default,
  // else the inline workspace.agent (pre-migration safety net).
  const agentsCol = adminDb.collection(`workspaces/${workspaceId}/agents`)
  type AgentRec = { id: string; systemPrompt: string; llmModel: string; openRouterKey?: string; knowledgeNamespace: string }
  let agentRec: AgentRec | undefined
  try {
    const toRec = (id: string, d: FirebaseFirestore.DocumentData): AgentRec => ({
      id,
      systemPrompt: d.systemPrompt ?? '',
      llmModel: d.llmModel ?? 'google/gemini-2.5-flash',
      openRouterKey: d.openRouterKey,
      knowledgeNamespace: d.knowledgeNamespace ?? `ws_${workspaceId}`,
    })
    const [specificSnap, defaultSnap] = await Promise.all([
      agentId ? agentsCol.doc(agentId).get() : Promise.resolve(null),
      agentsCol.where('isDefault', '==', true).limit(1).get(),
    ])
    const byId = new Map<string, AgentRec>()
    if (specificSnap && specificSnap.exists) { const r = toRec(specificSnap.id, specificSnap.data()!); byId.set(r.id, r) }
    const defaultAgent = defaultSnap.empty ? undefined : toRec(defaultSnap.docs[0]!.id, defaultSnap.docs[0]!.data())
    agentRec = resolveAgentDoc(agentId, byId, defaultAgent)
  } catch (err) {
    console.warn('[agent-turn] agent resolution failed:', err)
  }
  if (!agentRec) {
    const inline = workspaceData.agent ?? {}
    agentRec = {
      id: 'inline',
      systemPrompt: inline.systemPrompt ?? '',
      llmModel: inline.llmModel ?? 'google/gemini-2.5-flash',
      openRouterKey: workspaceData.openRouterKey,
      knowledgeNamespace: `ws_${workspaceId}`,
    }
  }
  const systemPrompt: string = agentRec.systemPrompt
  const storedModel: string = agentRec.llmModel ?? 'gemini-flash-latest'
  const llmModel: string = LEGACY_MODEL_MAP[storedModel] ?? storedModel

  const trace = getLangfuse().trace({
    name: 'agent-chat',
    sessionId: conversationId,
    userId: visitorId,
    input: { message: trimmed },
    metadata: { workspaceId, channelId, channelType, llmModel },
  })

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  if (convSnap.exists && convSnap.data()!.visitorId !== visitorId) {
    return { kind: 'error', error: 'Not found' }
  }

  // Silence guard: a conversation a human owns/queued never gets a bot reply.
  if (convSnap.exists && convSnap.data()!.status && convSnap.data()!.status !== 'bot') {
    await convRef.collection('messages').add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })
    await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: trimmed.slice(0, 200) })
    return { kind: 'silent' }
  }

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
    const periodUsed = reset ? 0 : (usage.periodConversationCount ?? 0)
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
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: trimmed,
      ...(telegramChatId !== undefined ? { telegramChatId } : {}),
    })
    const update: Record<string, unknown> = { 'usage.conversationCount': FieldValue.increment(1) }
    if (reset) {
      update['usage.periodConversationCount'] = 1
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

  const messagesRef = convRef.collection('messages')
  await messagesRef.add({ role: 'user', content: trimmed, createdAt: FieldValue.serverTimestamp() })

  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(10).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  // RAG (non-fatal)
  let contextBlocks: string[] = []
  let sources: Array<{ docId: string; source: string; score: number }> = []
  try {
    const queryEmbedding = await embedText(trimmed, trace)
    const retrievalSpan = trace.span({ name: 'pinecone-query', input: { topK: 5 } })
    const results = await namespaceFor(agentRec.knowledgeNamespace).query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
    retrievalSpan.end({ output: { matches: results.matches?.length ?? 0 } })
    const good = (results.matches ?? []).filter((m) => (m.score ?? 0) > 0.6)
    sources = good.map((m) => ({ docId: (m.metadata?.docId as string) ?? '', source: (m.metadata?.source as string) ?? '', score: m.score ?? 0 }))
    contextBlocks = good.map((m) => (m.metadata?.text as string) ?? '').filter(Boolean)
  } catch (err) {
    console.warn('[agent-turn] RAG retrieval failed:', err)
  }

  // Escalation rules (non-fatal): evaluate after RAG so low-confidence is known.
  try {
    const rulesSnap = await adminDb.collection(`workspaces/${workspaceId}/workflowRules`).where('enabled', '==', true).get()
    const rules: WorkflowRule[] = rulesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkflowRule, 'id'>) }))
    const hit = evaluateRules(rules, {
      messageLower: trimmed.toLowerCase(),
      botReplyCount: (convSnap.exists ? convSnap.data()!.botReplyCount : 0) ?? 0,
      sourceCount: sources.length,
      now: new Date(),
    })
    if (hit) {
      const handoff = hit.action.handoffMessage?.trim() || DEFAULT_HANDOFF
      await messagesRef.add({ role: 'assistant', content: handoff, createdAt: FieldValue.serverTimestamp(), metadata: { escalated: true } })
      await convRef.update({ status: 'waiting', escalationReason: hit.name, operatorId: null, updatedAt: FieldValue.serverTimestamp(), lastMessage: handoff.slice(0, 200) })
      await workspaceRef.update({ 'usage.messageCount': FieldValue.increment(2) }).catch(() => {})
      trace.update({ output: { escalated: hit.name } })
      return { kind: 'escalated', message: handoff }
    }
  } catch (err) {
    console.warn('[agent-turn] escalation check failed:', err)
  }

  // Key resolution
  const provider = providerOf(llmModel) ?? 'gemini'
  let keyResult
  try {
    keyResult = resolveOpenRouterKey(provider, agentRec.openRouterKey)
  } catch (err) {
    console.error('[agent-turn] key resolution failed:', err)
    return { kind: 'error', error: 'AI model needs an API key' }
  }
  if (!keyResult.ok) return { kind: 'error', error: 'AI model needs an API key' }

  const contextSection =
    contextBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${contextBlocks.join('\n\n')}\n---`
      : ''
  const fullSystemPrompt = systemPrompt + contextSection

  const chatMessages = history.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))
  chatMessages.push({ role: 'user', content: trimmed })

  // Tool/webhook actions (non-fatal): the model may call these during the turn.
  let tools: StoredTool[] = []
  try {
    tools = await loadTools(workspaceId, agentRec.id)
  } catch (err) {
    console.warn('[agent-turn] tool load failed:', err)
  }

  const persist = async (reply: string, promptTokens: number, completionTokens: number): Promise<string> => {
    const messageRef = await messagesRef.add({
      role: 'assistant',
      content: reply,
      createdAt: FieldValue.serverTimestamp(),
      metadata: { sources, llmModel, promptTokens, completionTokens },
    })
    try {
      await convRef.update({ updatedAt: FieldValue.serverTimestamp(), lastMessage: reply.slice(0, 200), botReplyCount: FieldValue.increment(1) })
      await workspaceRef.update({
        'usage.messageCount': FieldValue.increment(2),
        'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
      })
    } catch (err) {
      console.warn('[agent-turn] post-reply bookkeeping failed:', err)
    }
    trace.update({ output: { message: reply, sources } })
    return messageRef.id
  }

  return {
    kind: 'ready',
    chatParams: { model: llmModel, systemPrompt: fullSystemPrompt, messages: chatMessages, apiKey: keyResult.apiKey },
    sources,
    trace,
    llmModel,
    tools,
    persist,
  }
}
