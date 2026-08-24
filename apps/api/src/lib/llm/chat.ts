import type { LlmRuntime } from './runtime'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatParams {
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  runtime?: LlmRuntime
  /** Legacy test/helper input. Production turns pass runtime. */
  apiKey?: string
}
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }
