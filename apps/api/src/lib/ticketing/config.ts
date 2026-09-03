import { randomBytes } from 'node:crypto'
import { DEFAULT_TICKETING_CONFIG, validateTicketingConfig, type TicketingConfig } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { encryptSecret } from '../crypto'

export const ticketingConfigPath = (workspaceId: string, agentId: string) =>
  `workspaces/${workspaceId}/agents/${agentId}/settings/ticketing`

export type StoredTicketingConfig = Omit<TicketingConfig, 'destination'> & {
  destination:
    | { type: 'internal' }
    | { type: 'webhook'; url: string; signingSecretEnc: string }
    | { type: 'email'; address: string }
}

export async function loadTicketingConfig(workspaceId: string, agentId: string): Promise<StoredTicketingConfig> {
  const snap = await adminDb.doc(ticketingConfigPath(workspaceId, agentId)).get()
  if (!snap.exists) return DEFAULT_TICKETING_CONFIG as StoredTicketingConfig
  const data = snap.data() as StoredTicketingConfig
  return { ...DEFAULT_TICKETING_CONFIG, ...data, fields: Array.isArray(data.fields) ? data.fields : [] } as StoredTicketingConfig
}

export function safeTicketingConfig(config: StoredTicketingConfig): TicketingConfig {
  return {
    enabled: config.enabled,
    requireConfirmation: config.requireConfirmation,
    afterSubmission: config.afterSubmission,
    acknowledgementMessage: config.acknowledgementMessage,
    fields: config.fields,
    destination: config.destination.type === 'webhook'
      ? { type: 'webhook', url: config.destination.url, hasSigningSecret: Boolean(config.destination.signingSecretEnc) }
      : config.destination,
  }
}

export async function saveTicketingConfig(workspaceId: string, agentId: string, input: unknown): Promise<{ ok: true; value: StoredTicketingConfig; newSecret?: string } | { ok: false; error: string }> {
  const parsed = validateTicketingConfig(input)
  if (!parsed.ok) return parsed
  const previous = await loadTicketingConfig(workspaceId, agentId)
  const newSecret = parsed.value.destination.type === 'webhook' && !(previous.destination.type === 'webhook' && previous.destination.signingSecretEnc)
    ? randomBytes(32).toString('hex')
    : undefined
  const destination = parsed.value.destination.type === 'webhook'
    ? {
        type: 'webhook' as const,
        url: parsed.value.destination.url,
        signingSecretEnc: previous.destination.type === 'webhook' && previous.destination.signingSecretEnc
          ? previous.destination.signingSecretEnc
          : encryptSecret(newSecret!),
      }
    : parsed.value.destination
  const now = new Date()
  const value: StoredTicketingConfig = { ...parsed.value, destination }
  await adminDb.doc(ticketingConfigPath(workspaceId, agentId)).set({ ...value, updatedAt: now }, { merge: true })
  return { ok: true, value, ...(newSecret ? { newSecret } : {}) }
}

export async function rotateTicketingSecret(workspaceId: string, agentId: string): Promise<string | null> {
  const config = await loadTicketingConfig(workspaceId, agentId)
  if (config.destination.type !== 'webhook') return null
  const secret = randomBytes(32).toString('hex')
  await adminDb.doc(ticketingConfigPath(workspaceId, agentId)).update({
    'destination.signingSecretEnc': encryptSecret(secret), updatedAt: new Date(),
  })
  return secret
}
