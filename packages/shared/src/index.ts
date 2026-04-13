// LLM Providers (Claude, OpenAI, Gemini planned — Gemini only in v1)
export type LLMProvider = 'gemini' | 'claude' | 'openai'

// Gemini model options — update IDs to match actual available models
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Flash', description: 'Fast · Best for most cases' },
  { id: 'gemini-2.5-pro', label: 'Pro', description: 'Smarter · Better for complex topics' },
] as const

export type GeminiModelId = (typeof GEMINI_MODELS)[number]['id']

// Knowledge base
export type KnowledgeDocType = 'webpage' | 'file'
export type KnowledgeDocStatus = 'pending' | 'processing' | 'indexed' | 'error'

// Conversations
export type ConversationStatus = 'bot' | 'human' | 'resolved'
export type MessageRole = 'user' | 'assistant' | 'operator'

// Channels
export type ChannelType = 'web_widget' | 'telegram'

// Agent tone used during onboarding to build the system prompt
export type AgentTone = 'professional' | 'friendly' | 'casual'

// Firestore models
export interface UserDoc {
  email: string
  displayName: string
  photoURL: string | null
  workspaceId: string
  createdAt: Date
}

export interface AgentConfig {
  name: string
  photoURL: string | null
  description: string
  systemPrompt: string
  llmModel: GeminiModelId
}

export interface WorkspaceUsage {
  conversationCount: number
  tokenCount: number
}

export interface WorkspaceDoc {
  name: string
  ownerId: string
  createdAt: Date
  onboardingComplete: boolean
  agent: AgentConfig
  usage: WorkspaceUsage
}

export interface KnowledgeDoc {
  type: KnowledgeDocType
  source: string
  status: KnowledgeDocStatus
  chunkCount: number
  errorMessage: string | null
  createdAt: Date
  indexedAt: Date | null
}

export interface WidgetConfig {
  widgetColor: string
  widgetPosition: 'bottom-right' | 'bottom-left'
  welcomeMessage: string
  agentName: string
  agentPhotoURL: string | null
}

export interface ChannelDoc {
  type: ChannelType
  config: WidgetConfig
  embedCode: string
  isActive: boolean
  createdAt: Date
}

export interface MessageMetadata {
  sources: Array<{ docId: string; source: string; score: number }>
  llmModel?: string
  promptTokens?: number
  completionTokens?: number
}

export interface MessageDoc {
  role: MessageRole
  content: string
  createdAt: Date
  metadata?: MessageMetadata
}

export interface ConversationDoc {
  channelId: string
  visitorId: string
  status: ConversationStatus
  operatorId: string | null
  createdAt: Date
  updatedAt: Date
  lastMessage: string
}

// API types
export interface ChatRequest {
  agentId: string
  conversationId: string
  message: string
  visitorId: string
}

export interface WidgetConfigResponse {
  agentName: string
  agentPhotoURL: string | null
  widgetColor: string
  widgetPosition: 'bottom-right' | 'bottom-left'
  welcomeMessage: string
}
