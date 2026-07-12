// LLM Providers (Claude, OpenAI, Gemini)
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string // OpenRouter slug, e.g. "anthropic/claude-haiku-4.5"
  label: string
  description: string
}

// OpenRouter slugs confirmed live against https://openrouter.ai/api/v1/models on 2026-07-12.
export const LLM_MODELS: readonly LLMModel[] = [
  { provider: 'gemini', id: 'google/gemini-2.5-flash', label: 'Gemini Flash', description: 'Fast · Best for most cases' },
  { provider: 'gemini', id: 'google/gemini-2.5-pro', label: 'Gemini Pro', description: 'Smarter · Complex topics' },
  { provider: 'claude', id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku', description: 'Fast · Cost-effective' },
  { provider: 'claude', id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet', description: 'Strong reasoning' },
  { provider: 'openai', id: 'openai/gpt-5-mini', label: 'GPT-5 mini', description: 'Fast · Cost-effective' },
  { provider: 'openai', id: 'openai/gpt-5', label: 'GPT-5', description: 'Capable general model' },
] as const

/** Back-compat: the agent page and PUT validation still import GEMINI_MODELS. */
export const GEMINI_MODELS = LLM_MODELS.filter((m) => m.provider === 'gemini')

export function findModel(id: string): LLMModel | undefined {
  return LLM_MODELS.find((m) => m.id === id)
}

export function providerOf(id: string): LLMProvider | undefined {
  return findModel(id)?.provider
}

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
  llmModel: string
}

export interface WorkspaceUsage {
  conversationCount: number
  messageCount: number
  tokenCount: number
  periodConversationCount: number
  periodStart: Date | null
}

export interface WorkspaceDoc {
  name: string
  ownerId: string
  createdAt: Date
  onboardingComplete: boolean
  agent: AgentConfig
  usage: WorkspaceUsage
  subscription?: Subscription
  openRouterKey?: string // encrypted; server-only, never returned
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
  // The filename becomes part of a Storage object key — no path separators
  if (/[\\/]|\.\./.test(filename)) {
    return { ok: false, error: 'Invalid filename.' }
  }
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
// Billing
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
export type PlanTier = 'lite' | 'core' | 'max'

export interface Subscription {
  status: SubscriptionStatus
  tier: PlanTier | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface PlanDef {
  tier: PlanTier
  name: string
  priceUsd: number
  conversationCap: number
}

export const PLANS: readonly PlanDef[] = [
  { tier: 'lite', name: 'Lite', priceUsd: 25, conversationCap: 100 },
  { tier: 'core', name: 'Core', priceUsd: 55, conversationCap: 500 },
  { tier: 'max', name: 'Max', priceUsd: 195, conversationCap: 1500 },
]

export const TRIAL_DAYS = 14
export const TRIAL_CONVERSATION_CAP = 50

export function planFor(tier: PlanTier | null): PlanDef | undefined {
  return tier ? PLANS.find((p) => p.tier === tier) : undefined
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
