// LLM Providers (Claude, OpenAI, Gemini planned — Gemini only in v1)
export type LLMProvider = 'gemini' | 'claude' | 'openai'

// Gemini model options — update IDs to match actual available models
export const GEMINI_MODELS = [
  { id: 'gemini-flash-latest', label: 'Flash', description: 'Fast · Best for most cases' },
  { id: 'gemini-pro-latest', label: 'Pro', description: 'Smarter · Better for complex topics' },
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
  messageCount: number
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
  storagePath?: string
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
  hadTakeover?: boolean
  operatorId: string | null
  createdAt: Date
  updatedAt: Date
  lastMessage: string
}

// API types
export interface ChatRequest {
  channelId: string
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

// ---------------------------------------------------------------------------
// Knowledge file uploads
// ---------------------------------------------------------------------------

export const KNOWLEDGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.csv', '.md'] as const
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function validateKnowledgeFile(
  filename: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()
  if (!(KNOWLEDGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      error: `Unsupported file type "${ext || filename}". Allowed: ${KNOWLEDGE_FILE_EXTENSIONS.join(', ')}`,
    }
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'File is too large. Maximum size is 10 MB.' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// SSE events (widget <-> API)
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: 'chunk'; text: string }
  | {
      type: 'done'
      conversationId: string
      messageId: string
      sources: Array<{ docId: string; source: string; score: number }>
    }
  | { type: 'error'; error: string }

export type ConversationEvent =
  | { type: 'message'; id: string; role: MessageRole; content: string }
  | { type: 'status'; status: ConversationStatus }
