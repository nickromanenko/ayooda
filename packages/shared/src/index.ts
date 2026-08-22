import type { Subscription } from './plans'
import type { SkillId, SkillConfig } from './skills'

// LLM Providers (Claude, OpenAI, Gemini)
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string // AI Gateway model id, e.g. "anthropic/claude-haiku-4.5"
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
export type ConversationStatus = 'bot' | 'waiting' | 'human' | 'resolved'
export type MessageRole = 'user' | 'assistant' | 'operator'

// Channels
export type ChannelType = 'web_widget' | 'telegram'

// Agent tone used during onboarding to build the system prompt
export type AgentTone = 'professional' | 'friendly' | 'casual'

// Workspace & Team management
export type WorkspaceRole = 'owner' | 'member'

export interface PendingInvite {
  email: string       // lowercased
  workspaceId: string
  invitedBy: string   // uid of the inviting owner
  createdAt: Date
}

// Firestore models
export interface UserDoc {
  email: string
  displayName: string
  photoURL: string | null
  workspaceId: string
  createdAt: Date
  role?: WorkspaceRole
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
  copilotPeriodCount?: number  // internal Copilot threads this period
  /** Copilot message and token totals, kept separate from messageCount/tokenCount so the
   *  dashboard's avgMessages (messageCount / conversationCount) stays a support metric —
   *  Copilot increments no conversationCount, so folding it in would inflate that ratio. */
  copilotMessageCount?: number
  copilotTokenCount?: number
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
  config?: WidgetConfig
  embedCode?: string
  isActive: boolean
  createdAt: Date
  botTokenEnc?: string
  webhookSecret?: string
  telegram?: { botUsername: string; botId: number }
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
  escalationReason?: string
  botReplyCount?: number
  createdAt: Date
  updatedAt: Date
  lastMessage: string
  channelType?: ChannelType
  telegramChatId?: number
  agentId?: string                // which agent served this conversation (Task 7 writes it)
  score?: number                  // 1–5, written by the scoring skill
  summary?: string                // <= 500 chars
  scoredAt?: Date
  searchCallCount?: number        // web-search calls used by this conversation
  autoClosedAt?: Date             // set when the sweep closed an idle conversation
  pendingPostProcess?: boolean    // set on reaching `resolved`, cleared by the sweep
  postProcessedAt?: Date          // stamped by the sweep once post-processing has run, regardless
                                   // of which (if any) skills fired — the idempotency marker that
                                   // doesn't depend on the scoring skill's own scoredAt field
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

// ---------------------------------------------------------------------------
// Agent logo uploads
// ---------------------------------------------------------------------------

/** SVG is deliberately excluded — it can carry script and is served publicly. */
export const AGENT_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const
export const MAX_AGENT_IMAGE_BYTES = 2 * 1024 * 1024

export function validateAgentImage(
  filename: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  // The filename becomes part of a Storage object key — no path separators
  if (/[\\/]|\.\./.test(filename)) {
    return { ok: false, error: 'Invalid filename.' }
  }
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()
  if (!(AGENT_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      error: `Unsupported image type "${ext || filename}". Allowed: ${AGENT_IMAGE_EXTENSIONS.join(', ')}`,
    }
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: 'File is empty.' }
  }
  if (sizeBytes > MAX_AGENT_IMAGE_BYTES) {
    return { ok: false, error: 'Image is too large. Maximum size is 2 MB.' }
  }
  return { ok: true }
}

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
// SSE events (widget <-> API)
// ---------------------------------------------------------------------------

export * from './plans'
export * from './skills'
export * from './agent-roles'

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

// ---------------------------------------------------------------------------
// Tool / webhook actions
// ---------------------------------------------------------------------------

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ToolParamType = 'string' | 'number' | 'boolean'
export type ToolAuthType = 'none' | 'bearer' | 'header'
export type ToolKind = 'read' | 'write'

export interface ToolParam {
  name: string
  type: ToolParamType
  description: string
  required: boolean
}

/** Auth as returned to the web (no secret). Storage adds `secretEnc`; requests send `secret` (write-only). */
export interface ToolAuth {
  type: ToolAuthType
  headerName?: string
}

/** The tool as returned by GET /tools — never carries the secret. */
export interface ToolDef {
  id: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: ToolAuth
  hasSecret: boolean
  kind: ToolKind
  writeEnabled: boolean
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Agents (multiple per workspace)
// ---------------------------------------------------------------------------

/** The agent as returned by /agents — never carries the namespace. */
export interface AgentDoc {
  id: string
  name: string
  photoURL: string | null
  /** Role id from AGENT_ROLES; seeds systemPrompt at creation. Absent on agents created before roles existed. */
  role: string | null
  description: string
  systemPrompt: string
  llmModel: string
  isDefault: boolean
}

/** Compact shape for pickers/lists. */
export interface AgentSummary {
  id: string
  name: string
  photoURL: string | null
  llmModel: string
  isDefault: boolean
}

// ---------------------------------------------------------------------------
// Workflow / escalation rules
// ---------------------------------------------------------------------------

export type TriggerType = 'ask_for_human' | 'low_confidence' | 'bot_replies' | 'keyword' | 'off_hours'

export type WorkflowTrigger =
  | { type: 'ask_for_human'; phrases: string[] }
  | { type: 'low_confidence' }
  | { type: 'bot_replies'; count: number }
  | { type: 'keyword'; keywords: string[] }
  | { type: 'off_hours'; timezone: string; days: number[]; start: string; end: string }

export interface WorkflowAction {
  type: 'escalate'
  handoffMessage?: string
}

/** API↔web contract for a rule (no timestamps). */
export interface WorkflowRule {
  id: string
  name: string
  enabled: boolean
  order: number
  trigger: WorkflowTrigger
  action: WorkflowAction
}

/** Inputs the engine evaluates for one bot turn. */
export interface EscalationContext {
  messageLower: string
  botReplyCount: number
  sourceCount: number
  now: Date
}

// ---------------------------------------------------------------------------
// Tool templates (CRM / e-commerce starters)
// ---------------------------------------------------------------------------

export interface ToolTemplateSetupField {
  key: string          // referenced in the template as {{key}}
  label: string
  placeholder?: string
  help?: string
}

export interface ToolTemplate {
  id: string
  label: string
  category: string     // 'E-commerce' | 'CRM' | 'Support' | 'Generic'
  description: string
  setupFields: ToolTemplateSetupField[]
  toolName: string     // slug for the created tool
  toolDescription: string
  method: ToolMethod
  urlTemplate: string  // may contain {{setup}} and {param}
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>  // values may contain {{setup}}
  auth: { type: ToolAuthType; headerName?: string } // no secret — owner-entered
  kind: ToolKind
  secretLabel: string
}

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'shopify_order_lookup',
    label: 'Shopify — order lookup',
    category: 'E-commerce',
    description: 'Look up an order by its order number in your Shopify store.',
    setupFields: [
      { key: 'shop', label: 'Store subdomain', placeholder: 'my-store', help: 'The part before .myshopify.com' },
      { key: 'apiVersion', label: 'API version', placeholder: '2024-01' },
    ],
    toolName: 'shopify_order_lookup',
    toolDescription: 'Look up a Shopify order by its order number (e.g. #1001) to check status, fulfillment, and totals.',
    method: 'GET',
    urlTemplate: 'https://{{shop}}.myshopify.com/admin/api/{{apiVersion}}/orders.json?status=any&name={orderNumber}',
    params: [{ name: 'orderNumber', type: 'string', description: 'The order number, e.g. #1001', required: true }],
    headers: [],
    auth: { type: 'header', headerName: 'X-Shopify-Access-Token' },
    kind: 'read',
    secretLabel: 'Shopify Admin API access token',
  },
  {
    id: 'stripe_customer_lookup',
    label: 'Stripe — customer lookup',
    category: 'CRM',
    description: 'Find a Stripe customer by email address.',
    setupFields: [],
    toolName: 'stripe_customer_lookup',
    toolDescription: 'Look up a Stripe customer by email to check their account and subscription details.',
    method: 'GET',
    urlTemplate: 'https://api.stripe.com/v1/customers?email={email}',
    params: [{ name: 'email', type: 'string', description: "The customer's email address", required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Stripe secret key (sk_…)',
  },
  {
    id: 'hubspot_contact_lookup',
    label: 'HubSpot — contact by id',
    category: 'CRM',
    description: 'Fetch a HubSpot contact by its record id.',
    setupFields: [],
    toolName: 'hubspot_contact_lookup',
    toolDescription: 'Fetch a HubSpot contact by its record id to read their name, email, and phone.',
    method: 'GET',
    urlTemplate: 'https://api.hubapi.com/crm/v3/objects/contacts/{contactId}?properties=email,firstname,lastname,phone',
    params: [{ name: 'contactId', type: 'string', description: 'The HubSpot contact record id', required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'HubSpot private-app token',
  },
  {
    id: 'zendesk_ticket_lookup',
    label: 'Zendesk — ticket lookup',
    category: 'Support',
    description: 'Look up a Zendesk support ticket by id.',
    setupFields: [{ key: 'subdomain', label: 'Zendesk subdomain', placeholder: 'mycompany', help: 'The part before .zendesk.com' }],
    toolName: 'zendesk_ticket_lookup',
    toolDescription: 'Look up a Zendesk support ticket by its id to check its status and latest comments.',
    method: 'GET',
    urlTemplate: 'https://{{subdomain}}.zendesk.com/api/v2/tickets/{ticketId}.json',
    params: [{ name: 'ticketId', type: 'string', description: 'The Zendesk ticket id', required: true }],
    headers: [],
    auth: { type: 'header', headerName: 'Authorization' },
    kind: 'read',
    secretLabel: 'Basic auth value — "Basic " + base64("you@co.com/token:APITOKEN")',
  },
  {
    id: 'generic_rest_get',
    label: 'Generic REST (GET)',
    category: 'Generic',
    description: 'A blank GET request to any REST API — a starting point you can edit.',
    setupFields: [{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com', help: 'Without a trailing slash' }],
    toolName: 'rest_lookup',
    toolDescription: 'Look up a record by id from an external API.',
    method: 'GET',
    urlTemplate: '{{baseUrl}}/{id}',
    params: [{ name: 'id', type: 'string', description: 'The record id to look up', required: true }],
    headers: [],
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Bearer token (or set auth to None for a public API)',
  },
]

/** Substitute {{setup}} placeholders (URL + header values) from setupValues; leave {param} intact. */
export function applyTemplate(
  template: ToolTemplate,
  setupValues: Record<string, string>,
): {
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  auth: { type: ToolAuthType; headerName?: string }
  kind: ToolKind
} {
  const sub = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => setupValues[k] ?? '')
  return {
    name: template.toolName,
    description: template.toolDescription,
    method: template.method,
    urlTemplate: sub(template.urlTemplate),
    params: template.params.map((p) => ({ ...p })),
    headers: template.headers.map((h) => ({ key: h.key, value: sub(h.value) })),
    auth: { ...template.auth },
    kind: template.kind,
  }
}

// ---------------------------------------------------------------------------
// Skills — runtime documents and API views
// ---------------------------------------------------------------------------

export interface VisitorMemoryFact {
  id: string
  text: string
  createdAt: Date
  expiresAt: Date
}

/** workspaces/{ws}/visitorMemory/{visitorId} */
export interface VisitorMemoryDoc {
  facts: VisitorMemoryFact[]
  nextExpiryAt: Date | null   // min(facts[].expiresAt); drives the purge query
  updatedAt: Date
}

/** One row of GET /agents/:agentId/skills — catalogue merged with attachment state. */
export interface AgentSkillView {
  id: SkillId
  label: string
  description: string
  enabled: boolean
  config: SkillConfig
  locked: boolean             // true when the workspace plan is below minTier
}

// ---------------------------------------------------------------------------
// Copilot — internal in-app chat with a team member's own agent
// ---------------------------------------------------------------------------

/** workspaces/{ws}/copilotUsers/{uid}/threads/{threadId} */
export interface CopilotThreadDoc {
  uid: string
  agentId: string
  title: string          // first user message, truncated to 80 chars
  createdAt: Date
  updatedAt: Date
  lastMessage: string    // truncated to 200 chars
}
