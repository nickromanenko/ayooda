export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatParams { model: string; systemPrompt: string; messages: ChatMessage[]; apiKey: string }
export interface ChatChunk { text: string }
export interface ChatResult { promptTokens: number; completionTokens: number }
