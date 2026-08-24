import type { ToolSet } from 'ai'
import type { SkillId } from '@ayooda/shared'
import type { LangfuseTrace } from '../langfuse'
import type { LlmRuntime } from '../llm/runtime'

/** Gateway skill work uses a fixed inexpensive model; custom model names are provider-specific. */
export const SKILL_LLM_MODEL = 'google/gemini-2.5-flash'

export interface SkillContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  message: string // current user message, trimmed
  config: C // already validated
  trace: LangfuseTrace
}

export interface ConversationContext<C> {
  workspaceId: string
  agentId: string
  conversationId: string
  visitorId: string
  messages: Array<{ role: string; content: string }>
  runtime: LlmRuntime
  modelId: string
  config: C
}

export interface SkillModule<C = unknown> {
  id: SkillId
  contributeContext?(ctx: SkillContext<C>): Promise<string | null>
  contributeTools?(ctx: SkillContext<C>): Promise<ToolSet>
  afterConversation?(ctx: ConversationContext<C>): Promise<void>
}
