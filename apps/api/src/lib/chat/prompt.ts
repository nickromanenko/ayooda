import type { ChatMessage, ChatParams } from '../llm/chat'
import type { LlmRuntime } from '../llm/runtime'

export interface BuildChatParamsInput {
  systemPrompt: string
  contextBlocks: string[]
  skillBlocks: string[]
  /** Oldest-first. The final entry is the current message and is dropped. */
  history: Array<{ role: string; content: string }>
  message: string
  apiKey?: string
  runtime?: LlmRuntime
  model: string
}

/** Pure: the single place the context section and message array are assembled. */
export function buildChatParams(input: BuildChatParamsInput): ChatParams {
  const allBlocks = [...input.contextBlocks, ...input.skillBlocks]
  const contextSection =
    allBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${allBlocks.join('\n\n')}\n---`
      : ''

  const messages: ChatMessage[] = input.history.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))
  messages.push({ role: 'user', content: input.message })

  return {
    model: input.model,
    systemPrompt: input.systemPrompt + contextSection,
    messages,
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  }
}
