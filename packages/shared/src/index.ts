import type { Subscription, PlanTier } from './plans'
import type { SkillId, SkillConfig } from './skills'

export {
  KNOWLEDGE_SYNC_INTERVAL_HOURS,
  KNOWLEDGE_SYNC_LEASE_MINUTES,
  isKnowledgeSyncInterval,
  knowledgeSyncLeaseUntil,
  knowledgeSyncRetryAt,
  nextKnowledgeSyncAt,
} from './knowledge-sync'
export type { KnowledgeSyncIntervalHours } from './knowledge-sync'

// LLM Providers (Claude, OpenAI, Gemini)
export type LLMProvider = 'gemini' | 'claude' | 'openai'

export interface LLMModel {
  provider: LLMProvider
  id: string // AI Gateway model id, e.g. "anthropic/claude-haiku-4.5"
  label: string
  description: string
}

export interface GatewayModelInfo {
  id: string
  name: string
  description: string
  provider: string
  pricing: { input: string; output: string } | null
  contextWindow: number | null
  maxOutputTokens: number | null
  recommended: boolean
}

export interface GatewayModelCatalog {
  models: GatewayModelInfo[]
  dynamic: boolean
  fetchedAt: string | null
  warning?: string
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
export type ChannelType = 'web_widget' | 'telegram' | 'email' | 'slack'

// Email channel (Resend)
export interface EmailChannelConfig {
  /** The address the agent sends from (must be a Resend-verified domain). */
  fromAddress: string
  /** The address that receives inbound mail. */
  inboxAddress: string
}

export interface SlackChannelConfig {
  teamId: string
  teamName: string
  botUserId: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmailAddress(v: string): boolean {
  return EMAIL_RE.test(v)
}

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
  autoSyncEnabled?: boolean
  syncIntervalHours?: import('./knowledge-sync').KnowledgeSyncIntervalHours | null
  lastSyncedAt?: Date | null
  nextSyncAt?: Date | null
  syncStartedAt?: Date | null
  syncFailures?: number
  syncError?: string | null
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
  config?: WidgetConfig | EmailChannelConfig | SlackChannelConfig
  embedCode?: string
  isActive: boolean
  createdAt: Date
  botTokenEnc?: string
  resendApiKeyEnc?: string
  slackBotTokenEnc?: string
  slackSigningSecretEnc?: string
  webhookSecret?: string
  telegram?: { botUsername: string; botId: number }
  slack?: SlackChannelConfig
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
export * from './mcp'

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
export type ToolBodyEncoding = 'json' | 'form'

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
  /** Workspace connector credential used by this tool. The credential secret is never returned. */
  credentialId?: string
}

/** The tool as returned by GET /tools — never carries the secret. */
export interface ToolDef {
  id: string
  bundleId?: string
  templateId?: string
  name: string
  description: string
  method: ToolMethod
  urlTemplate: string
  params: ToolParam[]
  headers: Array<{ key: string; value: string }>
  bodyTemplate?: string
  bodyEncoding?: ToolBodyEncoding
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

/** Masked AI Gateway credential state. The key itself is write-only and never returned. */
export interface GatewayKeyStatus {
  hasAgentKey: boolean
  platformAvailable: boolean
  source: 'agent' | 'platform' | 'none'
}

/** Masked OpenAI-compatible endpoint state. The API key is write-only. */
export interface CustomEndpointStatus {
  configured: boolean
  baseURL: string | null
  modelId: string | null
  hasApiKey: boolean
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

export interface EscalateWorkflowAction {
  type: 'escalate'
  handoffMessage?: string
}

export interface ReplyWorkflowAction {
  type: 'reply'
  message: string
  /** Keep evaluating later matching rules; if none match, continue to the AI response. */
  continue: boolean
}

export interface ResolveWorkflowAction {
  type: 'resolve'
  message?: string
}

export interface AssignTeammateWorkflowAction {
  type: 'assign_teammate'
  teammateUid: string
  message?: string
}

export interface RouteAgentWorkflowAction {
  type: 'route_agent'
  agentId: string
  message?: string
}

export type WorkflowAction =
  | EscalateWorkflowAction
  | ReplyWorkflowAction
  | ResolveWorkflowAction
  | AssignTeammateWorkflowAction
  | RouteAgentWorkflowAction

export type WorkflowActionType = WorkflowAction['type']

export interface WorkflowTargets {
  teammates: Array<{ uid: string; name: string; email: string }>
  agents: Array<{ id: string; name: string }>
}

export type WorkflowGraphNode =
  | { id: string; kind: 'start'; name: string; position: { x: number; y: number } }
  | { id: string; kind: 'condition'; name: string; trigger: WorkflowTrigger; position: { x: number; y: number } }
  | { id: string; kind: 'action'; name: string; action: WorkflowAction; position: { x: number; y: number } }

export type WorkflowGraphBranch = 'always' | 'yes' | 'no'

export interface WorkflowGraphEdge {
  id: string
  from: string
  to: string
  branch: WorkflowGraphBranch
}

export interface WorkflowGraph {
  version: 1
  enabled: boolean
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
}

export interface WorkflowGraphResponse {
  graph: WorkflowGraph | null
  persisted: boolean
  legacyRuleCount: number
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
  /** JSON object/array whose string values may contain {param} placeholders. */
  bodyTemplate?: string
  bodyEncoding?: ToolBodyEncoding
  auth: { type: ToolAuthType; headerName?: string } // no secret — owner-entered
  kind: ToolKind
  secretLabel: string
}

export interface ToolBundle {
  id: string
  label: string
  category: string
  description: string
  templateIds: string[]
}

export type ConnectorAuthMode = 'oauth' | 'token'

/** Workspace connector state returned to the dashboard. Secrets and refresh tokens are never returned. */
export interface ConnectorStatus {
  providerId: string
  connected: boolean
  authMode: ConnectorAuthMode | null
  oauthAvailable: boolean
  setup: Record<string, string>
  updatedAt: string | null
}

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: 'shopify_order_lookup',
    label: 'Shopify — order lookup',
    category: 'E-commerce',
    description: 'Look up an order by its order number in your Shopify store.',
    setupFields: [
      { key: 'shop', label: 'Store subdomain', placeholder: 'my-store', help: 'The part before .myshopify.com' },
      { key: 'apiVersion', label: 'API version', placeholder: '2026-07' },
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
    id: 'shopify_refund',
    label: 'Shopify — refund an order',
    category: 'E-commerce',
    description: 'Refund a captured Shopify transaction and notify the customer.',
    setupFields: [
      { key: 'shop', label: 'Store subdomain', placeholder: 'my-store', help: 'The part before .myshopify.com' },
      { key: 'apiVersion', label: 'API version', placeholder: '2026-07' },
    ],
    toolName: 'shopify_refund_order',
    toolDescription: 'Refund a captured Shopify order transaction. Look up the order and its transactions first, then provide the order id, parent transaction id, gateway, currency, and amount. This action notifies the customer.',
    method: 'POST',
    urlTemplate: 'https://{{shop}}.myshopify.com/admin/api/{{apiVersion}}/orders/{orderId}/refunds.json',
    params: [
      { name: 'orderId', type: 'string', description: 'Shopify order id', required: true },
      { name: 'transactionId', type: 'string', description: 'Captured parent transaction id', required: true },
      { name: 'gateway', type: 'string', description: 'Payment gateway from the captured transaction', required: true },
      { name: 'currency', type: 'string', description: 'Three-letter currency code, e.g. USD', required: true },
      { name: 'amount', type: 'string', description: 'Decimal amount to refund, e.g. 24.99', required: true },
    ],
    headers: [],
    bodyTemplate: JSON.stringify({
      refund: {
        currency: '{currency}',
        notify: true,
        note: 'Refund issued by Ayooda',
        transactions: [{
          parent_id: '{transactionId}',
          amount: '{amount}',
          kind: 'refund',
          gateway: '{gateway}',
        }],
      },
    }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'header', headerName: 'X-Shopify-Access-Token' },
    kind: 'write',
    secretLabel: 'Shopify Admin API access token',
  },
  {
    id: 'shopify_transactions_lookup',
    label: 'Shopify — payment transactions',
    category: 'E-commerce',
    description: 'Get the captured transaction id and gateway needed to refund an order.',
    setupFields: [
      { key: 'shop', label: 'Store subdomain', placeholder: 'my-store', help: 'The part before .myshopify.com' },
      { key: 'apiVersion', label: 'API version', placeholder: '2026-07' },
    ],
    toolName: 'shopify_order_transactions',
    toolDescription: 'List payment transactions for a Shopify order. Use this before refunding to find the captured parent transaction id and gateway.',
    method: 'GET',
    urlTemplate: 'https://{{shop}}.myshopify.com/admin/api/{{apiVersion}}/orders/{orderId}/transactions.json',
    params: [{ name: 'orderId', type: 'string', description: 'Shopify order id', required: true }],
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
    id: 'stripe_customer_update',
    label: 'Stripe — update customer email',
    category: 'CRM',
    description: 'Update the email address on a Stripe customer.',
    setupFields: [],
    toolName: 'stripe_customer_update_email',
    toolDescription: 'Update a Stripe customer email address after confirming the new address with the customer.',
    method: 'POST',
    urlTemplate: 'https://api.stripe.com/v1/customers/{customerId}',
    params: [
      { name: 'customerId', type: 'string', description: 'Stripe customer id, e.g. cus_123', required: true },
      { name: 'email', type: 'string', description: 'New customer email address', required: true },
    ],
    headers: [],
    bodyTemplate: JSON.stringify({ email: '{email}' }, null, 2),
    bodyEncoding: 'form',
    auth: { type: 'bearer' },
    kind: 'write',
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
    id: 'hubspot_contact_update',
    label: 'HubSpot — update contact email',
    category: 'CRM',
    description: 'Update the email property on a HubSpot contact.',
    setupFields: [],
    toolName: 'hubspot_contact_update_email',
    toolDescription: 'Update a HubSpot contact email address after confirming it with the customer.',
    method: 'PATCH',
    urlTemplate: 'https://api.hubapi.com/crm/v3/objects/contacts/{contactId}',
    params: [
      { name: 'contactId', type: 'string', description: 'HubSpot contact record id', required: true },
      { name: 'email', type: 'string', description: 'New contact email address', required: true },
    ],
    headers: [],
    bodyTemplate: JSON.stringify({ properties: { email: '{email}' } }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'bearer' },
    kind: 'write',
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
    id: 'zendesk_ticket_resolve',
    label: 'Zendesk — resolve ticket',
    category: 'Support',
    description: 'Add a public resolution note and mark a Zendesk ticket solved.',
    setupFields: [{ key: 'subdomain', label: 'Zendesk subdomain', placeholder: 'mycompany', help: 'The part before .zendesk.com' }],
    toolName: 'zendesk_resolve_ticket',
    toolDescription: 'Post a public resolution comment and mark a Zendesk ticket solved after the customer request has been completed.',
    method: 'PUT',
    urlTemplate: 'https://{{subdomain}}.zendesk.com/api/v2/tickets/{ticketId}.json',
    params: [
      { name: 'ticketId', type: 'string', description: 'Zendesk ticket id', required: true },
      { name: 'comment', type: 'string', description: 'Public note explaining the resolution', required: true },
    ],
    headers: [],
    bodyTemplate: JSON.stringify({ ticket: { status: 'solved', comment: { body: '{comment}', public: true } } }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'header', headerName: 'Authorization' },
    kind: 'write',
    secretLabel: 'Basic auth value — "Basic " + base64("you@co.com/token:APITOKEN")',
  },
  {
    id: 'notion_search',
    label: 'Notion — search workspace',
    category: 'Knowledge',
    description: 'Search pages and databases shared with a Notion integration.',
    setupFields: [],
    toolName: 'notion_search',
    toolDescription: 'Search the connected Notion workspace for pages and databases relevant to the customer request.',
    method: 'POST',
    urlTemplate: 'https://api.notion.com/v1/search',
    params: [{ name: 'query', type: 'string', description: 'Text to search for in page and database titles', required: true }],
    headers: [{ key: 'Notion-Version', value: '2026-03-11' }],
    bodyTemplate: JSON.stringify({ query: '{query}', page_size: 20 }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Notion integration secret',
  },
  {
    id: 'linear_issue_lookup',
    label: 'Linear — issue lookup',
    category: 'Support',
    description: 'Fetch a Linear issue by its identifier, such as ENG-123.',
    setupFields: [],
    toolName: 'linear_issue_lookup',
    toolDescription: 'Look up a Linear issue by identifier to read its title, description, status, priority, and URL.',
    method: 'POST',
    urlTemplate: 'https://api.linear.app/graphql',
    params: [{ name: 'issueId', type: 'string', description: 'Linear issue identifier, e.g. ENG-123', required: true }],
    headers: [],
    bodyTemplate: JSON.stringify({
      query: 'query Issue($id: String!) { issue(id: $id) { id identifier title description priority url state { name type } } }',
      variables: { id: '{issueId}' },
    }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'header', headerName: 'Authorization' },
    kind: 'read',
    secretLabel: 'Linear personal API key',
  },
  {
    id: 'intercom_contact_lookup',
    label: 'Intercom — contact by email',
    category: 'CRM',
    description: 'Find an Intercom contact by email address.',
    setupFields: [],
    toolName: 'intercom_contact_lookup',
    toolDescription: 'Find an Intercom contact by email to read their profile and account context.',
    method: 'POST',
    urlTemplate: 'https://api.intercom.io/contacts/search',
    params: [{ name: 'email', type: 'string', description: 'Customer email address', required: true }],
    headers: [{ key: 'Intercom-Version', value: '2.14' }],
    bodyTemplate: JSON.stringify({ query: { field: 'email', operator: '=', value: '{email}' } }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'bearer' },
    kind: 'read',
    secretLabel: 'Intercom access token',
  },
  {
    id: 'zapier_webhook_action',
    label: 'Zapier — trigger webhook',
    category: 'Automation',
    description: 'Trigger a Zapier Catch Hook with a customer-support event.',
    setupFields: [{ key: 'webhookUrl', label: 'Zapier webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', help: 'Copy this from a Zapier Catch Hook trigger' }],
    toolName: 'zapier_trigger_workflow',
    toolDescription: 'Trigger the connected Zapier workflow with an event name, customer email, and message after the requested action has been confirmed.',
    method: 'POST',
    urlTemplate: '{{webhookUrl}}',
    params: [
      { name: 'event', type: 'string', description: 'Stable event name for the Zap, e.g. support_refund_completed', required: true },
      { name: 'customerEmail', type: 'string', description: 'Customer email address', required: true },
      { name: 'message', type: 'string', description: 'Human-readable event details', required: true },
    ],
    headers: [],
    bodyTemplate: JSON.stringify({ event: '{event}', customerEmail: '{customerEmail}', message: '{message}' }, null, 2),
    bodyEncoding: 'json',
    auth: { type: 'none' },
    kind: 'write',
    secretLabel: 'No additional secret — the hook URL contains its credential',
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

/** Provider-level installs. Every template in a bundle shares one setup and credential step. */
export const TOOL_BUNDLES: ToolBundle[] = [
  {
    id: 'shopify', label: 'Shopify', category: 'E-commerce',
    description: 'Order lookup, payment transactions, and customer-notifying refunds.',
    templateIds: ['shopify_order_lookup', 'shopify_transactions_lookup', 'shopify_refund'],
  },
  {
    id: 'stripe', label: 'Stripe', category: 'Payments',
    description: 'Customer lookup and confirmed email updates.',
    templateIds: ['stripe_customer_lookup', 'stripe_customer_update'],
  },
  {
    id: 'hubspot', label: 'HubSpot', category: 'CRM',
    description: 'Contact lookup and confirmed email updates.',
    templateIds: ['hubspot_contact_lookup', 'hubspot_contact_update'],
  },
  {
    id: 'zendesk', label: 'Zendesk', category: 'Support',
    description: 'Ticket lookup plus public resolution and solve actions.',
    templateIds: ['zendesk_ticket_lookup', 'zendesk_ticket_resolve'],
  },
  {
    id: 'notion', label: 'Notion', category: 'Knowledge',
    description: 'Search pages and databases shared with your integration.',
    templateIds: ['notion_search'],
  },
  {
    id: 'linear', label: 'Linear', category: 'Support',
    description: 'Look up issues by identifier with status and priority context.',
    templateIds: ['linear_issue_lookup'],
  },
  {
    id: 'intercom', label: 'Intercom', category: 'CRM',
    description: 'Find customer contacts and account context by email.',
    templateIds: ['intercom_contact_lookup'],
  },
  {
    id: 'zapier', label: 'Zapier', category: 'Automation',
    description: 'Trigger a Catch Hook with structured customer-support events.',
    templateIds: ['zapier_webhook_action'],
  },
]

export function templatesForToolBundle(bundle: ToolBundle): ToolTemplate[] {
  return bundle.templateIds
    .map((id) => TOOL_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is ToolTemplate => !!template)
}

export function setupFieldsForToolBundle(bundle: ToolBundle): ToolTemplateSetupField[] {
  const fields = new Map<string, ToolTemplateSetupField>()
  for (const template of templatesForToolBundle(bundle)) {
    for (const field of template.setupFields) if (!fields.has(field.key)) fields.set(field.key, field)
  }
  return [...fields.values()]
}

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
  bodyTemplate?: string
  bodyEncoding?: ToolBodyEncoding
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
    ...(template.bodyTemplate ? { bodyTemplate: sub(template.bodyTemplate) } : {}),
    ...(template.bodyEncoding ? { bodyEncoding: template.bodyEncoding } : {}),
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

// ---------------------------------------------------------------------------
// Web widget appearance
// ---------------------------------------------------------------------------

export const WIDGET_POSITIONS = [
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'bottom-left', label: 'Bottom left' },
] as const

export type WidgetPosition = (typeof WIDGET_POSITIONS)[number]['id']

export const DEFAULT_WIDGET_COLOR = '#6366f1'
export const DEFAULT_WIDGET_POSITION: WidgetPosition = 'bottom-right'
export const MAX_WELCOME_MESSAGE_CHARS = 200

/** Plan required to hide the "Powered by Ayooda" line. Enforced on read as well
 *  as on write, so a downgrade puts the badge back rather than leaving a lapsed
 *  workspace with a benefit it no longer pays for. */
export const MIN_BRANDING_TIER: PlanTier = 'core'

/** How the embedded chat widget looks on the customer's own site. */
export interface WidgetAppearance {
  widgetColor: string
  widgetPosition: WidgetPosition
  welcomeMessage: string
  /** Show the "Powered by Ayooda" line. Always true below MIN_BRANDING_TIER. */
  showBranding: boolean
}

// ---------------------------------------------------------------------------
// Per-agent access
// ---------------------------------------------------------------------------

/**
 * Who may configure an agent.
 *
 * Workspace owners may configure every agent. A member may configure only the
 * agents they have been given access to, listed on the agent itself. Creating,
 * deleting and re-defaulting an agent stays owner-only regardless — those are
 * workspace-shaped decisions, not agent-shaped ones.
 */
export function canEditAgent(
  role: WorkspaceRole | undefined,
  editorUids: readonly string[] | undefined,
  uid: string | undefined,
): boolean {
  if (role === 'owner') return true
  // An unrecognised role means the session could not be established, so refuse
  // rather than falling through to the list — being listed is only meaningful
  // for a caller we have actually identified.
  if (role !== 'member' || !uid) return false
  return Array.isArray(editorUids) && editorUids.includes(uid)
}

/** One row of the agent's access list, as shown on its Security tab. */
export interface AgentAccessEntry {
  uid: string
  email: string
  displayName: string
  role: WorkspaceRole
  /** Owners always have access and cannot be removed from it. */
  hasAccess: boolean
  locked: boolean
}
