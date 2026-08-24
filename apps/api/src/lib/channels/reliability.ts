import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../firebase-admin'
import { dispatchChannelAlert, loadChannelAlertSettings, nextChannelIncidentState } from './alerts'

export type ChannelReliabilityOutcome = 'success' | 'failure'
export type ChannelReliabilityDirection = 'inbound' | 'outbound' | 'diagnostic'

export interface ChannelReliabilityEventInput {
  workspaceId: string
  channelId: string
  channelType: string
  direction: ChannelReliabilityDirection
  outcome: ChannelReliabilityOutcome
  stage: string
  detail?: string
  conversationId?: string
}

const EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000

export function safeReliabilityDetail(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Unknown error'
  return message
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bxox[bp]-[A-Za-z0-9-]+\b/g, '[redacted]')
    .replace(/\b(?:sk|re)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

export function reliabilityStatus(input: {
  isActive?: boolean
  lastSuccessAt?: unknown
  lastFailureAt?: unknown
  consecutiveFailures?: number
}): 'inactive' | 'healthy' | 'failing' | 'unchecked' {
  if (input.isActive === false) return 'inactive'
  if ((input.consecutiveFailures ?? 0) > 0) return 'failing'
  if (input.lastSuccessAt) return 'healthy'
  if (input.lastFailureAt) return 'failing'
  return 'unchecked'
}

/** Reliability tracking must never interrupt customer message handling. */
export async function recordChannelReliability(input: ChannelReliabilityEventInput): Promise<void> {
  const now = new Date()
  const stateRef = adminDb.doc(`workspaces/${input.workspaceId}/channelReliability/${input.channelId}`)
  const eventRef = stateRef.collection('events').doc()
  const detail = input.detail ? safeReliabilityDetail(input.detail) : null
  const event = {
    channelId: input.channelId,
    channelType: input.channelType,
    direction: input.direction,
    outcome: input.outcome,
    stage: input.stage,
    detail,
    conversationId: input.conversationId ?? null,
    occurredAt: now,
    expiresAt: new Date(now.getTime() + EVENT_RETENTION_MS),
  }
  const stateUpdate = {
    channelId: input.channelId,
    channelType: input.channelType,
    lastEventAt: now,
    lastDirection: input.direction,
    lastStage: input.stage,
    lastDetail: detail,
    ...(input.direction === 'inbound' ? { lastInboundAt: now } : {}),
    ...(input.direction === 'outbound' ? { lastOutboundAt: now } : {}),
    ...(input.outcome === 'success'
      ? { lastSuccessAt: now, successCount: FieldValue.increment(1), consecutiveFailures: 0 }
      : { lastFailureAt: now, failureCount: FieldValue.increment(1), consecutiveFailures: FieldValue.increment(1) }),
  }

  try {
    const settings = await loadChannelAlertSettings(input.workspaceId).catch(() => null)
    if (!settings?.enabled) {
      const batch = adminDb.batch()
      batch.set(eventRef, event)
      batch.set(stateRef, stateUpdate, { merge: true })
      await batch.commit()
      return
    }

    const transition = await adminDb.runTransaction(async (transaction) => {
      const stateSnap = await transaction.get(stateRef)
      const state = stateSnap.data() ?? {}
      const incident = nextChannelIncidentState({
        outcome: input.outcome,
        consecutiveFailures: Number(state.consecutiveFailures ?? 0),
        incidentOpen: state.alertIncidentOpen === true,
        threshold: settings.threshold,
      })
      transaction.set(eventRef, event)
      transaction.set(stateRef, {
        ...stateUpdate,
        consecutiveFailures: incident.consecutiveFailures,
        alertIncidentOpen: incident.incidentOpen,
        ...(incident.alertKind ? { lastAlertKind: incident.alertKind, lastAlertAt: now } : {}),
      }, { merge: true })
      return incident
    })

    if (transition.alertKind) {
      const result = await dispatchChannelAlert({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        channelType: input.channelType,
        kind: transition.alertKind,
        threshold: settings.threshold,
        consecutiveFailures: transition.consecutiveFailures,
        detail,
        settings,
      })
      await stateRef.set({
        lastAlertDeliveryAt: new Date(),
        lastAlertDeliveryStatus: result.failed === 0 ? 'delivered' : result.delivered > 0 ? 'partial' : 'failed',
        lastAlertDeliveryDetail: result.detail,
      }, { merge: true })
    }
  } catch (error) {
    console.warn('[channel-reliability] event write failed:', safeReliabilityDetail(error))
  }
}
