export const TICKET_FIELD_TYPES = ['text', 'long_text', 'number', 'boolean', 'select'] as const
export type TicketFieldType = typeof TICKET_FIELD_TYPES[number]

export interface TicketIntakeField {
  id: string
  label: string
  description: string
  type: TicketFieldType
  required: boolean
  options?: string[]
}

export type TicketDestination =
  | { type: 'internal' }
  | { type: 'webhook'; url: string; hasSigningSecret?: boolean }
  | { type: 'email'; address: string }

export interface TicketingConfig {
  enabled: boolean
  requireConfirmation: boolean
  afterSubmission: 'continue' | 'handoff'
  acknowledgementMessage: string
  fields: TicketIntakeField[]
  destination: TicketDestination
}

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketDeliveryState = 'not_configured' | 'pending' | 'delivered' | 'failed'

export interface SupportTicket {
  id: string
  number: number
  agentId: string
  conversationId: string
  channelId: string | null
  channelType: string | null
  status: TicketStatus
  priority: TicketPriority
  subject: string
  description: string
  fields: Record<string, string | number | boolean>
  customer: { name: string | null; email: string | null; phone: string | null; visitorId: string | null }
  assigneeUid: string | null
  deliveryState: TicketDeliveryState
  externalId: string | null
  externalUrl: string | null
  createdBy: 'agent' | 'operator'
  createdAt: unknown
  updatedAt: unknown
}

export interface TicketSubmission {
  subject: string
  description: string
  priority: TicketPriority
  customerConfirmed: boolean
  fields: Record<string, string | number | boolean>
}

export const DEFAULT_TICKETING_CONFIG: TicketingConfig = {
  enabled: false,
  requireConfirmation: true,
  afterSubmission: 'continue',
  acknowledgementMessage: 'Thanks — your support request has been created as ticket #{number}.',
  fields: [],
  destination: { type: 'internal' },
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateTicketingConfig(input: unknown): Validation<TicketingConfig> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Ticket settings are required.' }
  const value = input as Record<string, unknown>
  const enabled = value.enabled === true
  const requireConfirmation = value.requireConfirmation !== false
  const afterSubmission = value.afterSubmission === 'handoff' ? 'handoff' : value.afterSubmission === 'continue' ? 'continue' : null
  if (!afterSubmission) return { ok: false, error: 'Choose what happens after a ticket is submitted.' }
  const acknowledgementMessage = typeof value.acknowledgementMessage === 'string' ? value.acknowledgementMessage.trim() : ''
  if (!acknowledgementMessage || acknowledgementMessage.length > 500) return { ok: false, error: 'Acknowledgement message must be between 1 and 500 characters.' }
  if (!Array.isArray(value.fields) || value.fields.length > 10) return { ok: false, error: 'Add no more than 10 custom fields.' }

  const fields: TicketIntakeField[] = []
  const ids = new Set<string>()
  for (const raw of value.fields) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Each custom field must be valid.' }
    const field = raw as Record<string, unknown>
    const id = typeof field.id === 'string' ? field.id.trim() : ''
    const label = typeof field.label === 'string' ? field.label.trim() : ''
    const description = typeof field.description === 'string' ? field.description.trim() : ''
    if (!FIELD_ID.test(id)) return { ok: false, error: 'Field IDs must start with a letter and contain only lowercase letters, numbers, or underscores.' }
    if (ids.has(id)) return { ok: false, error: `Custom field "${id}" is duplicated.` }
    if (!label || label.length > 60) return { ok: false, error: 'Field labels must be between 1 and 60 characters.' }
    if (description.length > 240) return { ok: false, error: `Description for "${label}" is too long.` }
    if (!TICKET_FIELD_TYPES.includes(field.type as TicketFieldType)) return { ok: false, error: `Choose a valid type for "${label}".` }
    const type = field.type as TicketFieldType
    let options: string[] | undefined
    if (type === 'select') {
      if (!Array.isArray(field.options)) return { ok: false, error: `Add choices for "${label}".` }
      options = [...new Set(field.options.map((option) => typeof option === 'string' ? option.trim() : '').filter(Boolean))]
      if (!options.length || options.length > 20) return { ok: false, error: `Add between 1 and 20 choices for "${label}".` }
    }
    ids.add(id)
    fields.push({ id, label, description, type, required: field.required === true, ...(options ? { options } : {}) })
  }

  const destinationRaw = value.destination
  if (!destinationRaw || typeof destinationRaw !== 'object') return { ok: false, error: 'Choose a ticket destination.' }
  const destinationValue = destinationRaw as Record<string, unknown>
  let destination: TicketDestination
  if (destinationValue.type === 'internal') destination = { type: 'internal' }
  else if (destinationValue.type === 'webhook') {
    const url = typeof destinationValue.url === 'string' ? destinationValue.url.trim() : ''
    let parsed: URL
    try { parsed = new URL(url) } catch { return { ok: false, error: 'Enter a valid webhook URL.' } }
    if (parsed.protocol !== 'https:') return { ok: false, error: 'Webhook URLs must use HTTPS.' }
    destination = { type: 'webhook', url }
  } else if (destinationValue.type === 'email') {
    const address = typeof destinationValue.address === 'string' ? destinationValue.address.trim().toLowerCase() : ''
    if (!EMAIL.test(address) || address.length > 254) return { ok: false, error: 'Enter a valid support email address.' }
    destination = { type: 'email', address }
  } else return { ok: false, error: 'Choose a valid ticket destination.' }

  return { ok: true, value: { enabled, requireConfirmation, afterSubmission, acknowledgementMessage, fields, destination } }
}

export function validateTicketSubmission(input: unknown, config: TicketingConfig): Validation<TicketSubmission> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Ticket details are required.' }
  const value = input as Record<string, unknown>
  const subject = typeof value.subject === 'string' ? value.subject.trim() : ''
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (!subject || subject.length > 160) return { ok: false, error: 'Subject must be between 1 and 160 characters.' }
  if (!description || description.length > 4000) return { ok: false, error: 'Description must be between 1 and 4,000 characters.' }
  const priority = value.priority ?? 'normal'
  if (!['low', 'normal', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'Choose a valid ticket priority.' }
  if (config.requireConfirmation && value.customerConfirmed !== true) return { ok: false, error: 'Ask the customer to confirm before submitting this ticket.' }
  const rawFields = value.fields && typeof value.fields === 'object' && !Array.isArray(value.fields) ? value.fields as Record<string, unknown> : {}
  const fields: Record<string, string | number | boolean> = {}
  for (const key of Object.keys(rawFields)) if (!config.fields.some((field) => field.id === key)) return { ok: false, error: `Unknown ticket field "${key}".` }
  for (const field of config.fields) {
    const raw = rawFields[field.id]
    if ((raw === undefined || raw === null || raw === '') && field.required) return { ok: false, error: `Missing required field: ${field.label}.` }
    if (raw === undefined || raw === null || raw === '') continue
    if (field.type === 'number' && typeof raw !== 'number') return { ok: false, error: `${field.label} must be a number.` }
    if (field.type === 'boolean' && typeof raw !== 'boolean') return { ok: false, error: `${field.label} must be true or false.` }
    if (!['number', 'boolean'].includes(field.type) && typeof raw !== 'string') return { ok: false, error: `${field.label} must be text.` }
    if (typeof raw === 'string' && raw.length > (field.type === 'long_text' ? 4000 : 500)) return { ok: false, error: `${field.label} is too long.` }
    if (field.type === 'select' && !field.options?.includes(String(raw))) return { ok: false, error: `Choose a valid value for ${field.label}.` }
    fields[field.id] = raw as string | number | boolean
  }
  return { ok: true, value: { subject, description, priority: priority as TicketPriority, customerConfirmed: value.customerConfirmed === true, fields } }
}
