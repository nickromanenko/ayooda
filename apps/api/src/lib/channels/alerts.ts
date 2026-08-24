import { adminDb } from '../firebase-admin'
import { decryptSecret } from '../crypto'
import { sendEmail } from '../email/client'
import { sendSlackMessage } from '../slack/client'
import { isEmailAddress } from '@ayooda/shared'

export type ChannelAlertKind = 'failure' | 'recovery'

export interface ChannelAlertSettings {
  enabled: boolean
  threshold: number
  email: { enabled: boolean; address: string; transportChannelId: string }
  slack: { enabled: boolean; destination: string; transportChannelId: string }
}

export interface ChannelIncidentState {
  consecutiveFailures: number
  incidentOpen: boolean
  alertKind: ChannelAlertKind | null
}

export const DEFAULT_CHANNEL_ALERT_THRESHOLD = 3
const SETTINGS_CACHE_MS = 60_000
const SLACK_DESTINATION_RE = /^[CDG][A-Z0-9]{8,32}$/i
const settingsCache = new Map<string, { value: ChannelAlertSettings; expiresAt: number }>()

export function defaultChannelAlertSettings(): ChannelAlertSettings {
  return {
    enabled: false,
    threshold: DEFAULT_CHANNEL_ALERT_THRESHOLD,
    email: { enabled: false, address: '', transportChannelId: '' },
    slack: { enabled: false, destination: '', transportChannelId: '' },
  }
}

export function normalizeChannelAlertSettings(value: unknown): ChannelAlertSettings {
  const fallback = defaultChannelAlertSettings()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const input = value as Record<string, unknown>
  const email = input.email && typeof input.email === 'object' && !Array.isArray(input.email)
    ? input.email as Record<string, unknown>
    : {}
  const slack = input.slack && typeof input.slack === 'object' && !Array.isArray(input.slack)
    ? input.slack as Record<string, unknown>
    : {}
  const threshold = Number(input.threshold)
  return {
    enabled: input.enabled === true,
    threshold: Number.isInteger(threshold) && threshold >= 2 && threshold <= 10
      ? threshold
      : DEFAULT_CHANNEL_ALERT_THRESHOLD,
    email: {
      enabled: email.enabled === true,
      address: typeof email.address === 'string' ? email.address.trim().toLowerCase() : '',
      transportChannelId: typeof email.transportChannelId === 'string' ? email.transportChannelId.trim() : '',
    },
    slack: {
      enabled: slack.enabled === true,
      destination: typeof slack.destination === 'string' ? slack.destination.trim().toUpperCase() : '',
      transportChannelId: typeof slack.transportChannelId === 'string' ? slack.transportChannelId.trim() : '',
    },
  }
}

export function validateChannelAlertSettings(value: unknown):
  | { ok: true; value: ChannelAlertSettings }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Alert settings must be an object.' }
  }
  const input = value as Record<string, unknown>
  if (typeof input.enabled !== 'boolean') return { ok: false, error: 'Alert enabled state is required.' }
  if (!input.email || typeof input.email !== 'object' || Array.isArray(input.email)) {
    return { ok: false, error: 'Email alert settings are required.' }
  }
  if (!input.slack || typeof input.slack !== 'object' || Array.isArray(input.slack)) {
    return { ok: false, error: 'Slack alert settings are required.' }
  }
  if (typeof (input.email as Record<string, unknown>).enabled !== 'boolean' || typeof (input.slack as Record<string, unknown>).enabled !== 'boolean') {
    return { ok: false, error: 'Each alert destination needs an enabled state.' }
  }
  const settings = normalizeChannelAlertSettings(value)
  const threshold = Number(input.threshold)
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 10) {
    return { ok: false, error: 'Failure threshold must be a whole number between 2 and 10.' }
  }
  if (settings.email.enabled) {
    if (!isEmailAddress(settings.email.address)) return { ok: false, error: 'Enter a valid alert email address.' }
    if (!settings.email.transportChannelId || settings.email.transportChannelId.length > 128) return { ok: false, error: 'Choose a valid email channel for alert delivery.' }
  }
  if (settings.slack.enabled) {
    if (!SLACK_DESTINATION_RE.test(settings.slack.destination)) {
      return { ok: false, error: 'Enter a Slack channel or conversation ID such as C0123456789.' }
    }
    if (!settings.slack.transportChannelId || settings.slack.transportChannelId.length > 128) return { ok: false, error: 'Choose a valid Slack app for alert delivery.' }
  }
  if (settings.enabled && !settings.email.enabled && !settings.slack.enabled) {
    return { ok: false, error: 'Enable at least one alert destination.' }
  }
  return { ok: true, value: settings }
}

export function nextChannelIncidentState(input: {
  outcome: 'success' | 'failure'
  consecutiveFailures?: number
  incidentOpen?: boolean
  threshold: number
}): ChannelIncidentState {
  const wasOpen = input.incidentOpen === true
  if (input.outcome === 'success') {
    return { consecutiveFailures: 0, incidentOpen: false, alertKind: wasOpen ? 'recovery' : null }
  }
  const consecutiveFailures = Math.max(0, Number(input.consecutiveFailures ?? 0)) + 1
  const alertKind = !wasOpen && consecutiveFailures >= input.threshold ? 'failure' : null
  return { consecutiveFailures, incidentOpen: wasOpen || alertKind === 'failure', alertKind }
}

export async function loadChannelAlertSettings(workspaceId: string): Promise<ChannelAlertSettings> {
  const cached = settingsCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const snap = await adminDb.doc(`workspaces/${workspaceId}/channelAlertSettings/default`).get()
  const value = normalizeChannelAlertSettings(snap.data())
  settingsCache.set(workspaceId, { value, expiresAt: Date.now() + SETTINGS_CACHE_MS })
  return value
}

export function invalidateChannelAlertSettings(workspaceId: string): void {
  settingsCache.delete(workspaceId)
}

function alertCopy(input: {
  kind: ChannelAlertKind
  channelType: string
  agentName: string
  threshold: number
  consecutiveFailures: number
  detail: string | null
}): { subject: string; text: string } {
  const provider = input.channelType.replaceAll('_', ' ')
  if (input.kind === 'recovery') {
    return {
      subject: `Recovered: ${provider} channel for ${input.agentName}`,
      text: `Ayooda channel recovery\n\n${provider} for ${input.agentName} is healthy again. A successful event closed the reliability incident.`,
    }
  }
  return {
    subject: `Action needed: ${provider} channel for ${input.agentName}`,
    text: `Ayooda channel alert\n\n${provider} for ${input.agentName} reached ${input.consecutiveFailures} consecutive failures (alert threshold: ${input.threshold}).${input.detail ? `\n\nLatest failure: ${input.detail}` : ''}\n\nOpen Channel health in Ayooda to run a connection check and inspect recent activity.`,
  }
}

export async function dispatchChannelAlert(input: {
  workspaceId: string
  channelId: string
  channelType: string
  kind: ChannelAlertKind
  threshold: number
  consecutiveFailures: number
  detail: string | null
  settings: ChannelAlertSettings
}): Promise<{ delivered: number; failed: number; detail: string | null }> {
  const monitored = await adminDb.doc(`workspaces/${input.workspaceId}/channels/${input.channelId}`).get()
  const agentId = monitored.data()?.agentId
  const agent = typeof agentId === 'string'
    ? await adminDb.doc(`workspaces/${input.workspaceId}/agents/${agentId}`).get()
    : null
  const copy = alertCopy({
    kind: input.kind,
    channelType: input.channelType,
    agentName: String(agent?.data()?.name ?? monitored.data()?.config?.agentName ?? 'Support Agent'),
    threshold: input.threshold,
    consecutiveFailures: input.consecutiveFailures,
    detail: input.detail,
  })
  const deliveries: Promise<void>[] = []

  if (input.settings.email.enabled) {
    deliveries.push((async () => {
      const transport = await adminDb.doc(`workspaces/${input.workspaceId}/channels/${input.settings.email.transportChannelId}`).get()
      const data = transport.data()
      if (!transport.exists || data?.type !== 'email' || data.isActive === false) throw new Error('Configured email alert channel is unavailable.')
      await sendEmail({
        apiKey: decryptSecret(String(data.resendApiKeyEnc ?? '')),
        from: String(data.config?.fromAddress ?? ''),
        to: input.settings.email.address,
        subject: copy.subject,
        text: copy.text,
      })
    })())
  }
  if (input.settings.slack.enabled) {
    deliveries.push((async () => {
      const transport = await adminDb.doc(`workspaces/${input.workspaceId}/channels/${input.settings.slack.transportChannelId}`).get()
      const data = transport.data()
      if (!transport.exists || data?.type !== 'slack' || data.isActive === false) throw new Error('Configured Slack alert app is unavailable.')
      await sendSlackMessage(
        decryptSecret(String(data.slackBotTokenEnc ?? '')),
        input.settings.slack.destination,
        `*${copy.subject}*\n${copy.text.replace(/^Ayooda channel (?:alert|recovery)\n\n/, '')}`,
      )
    })())
  }

  const results = await Promise.allSettled(deliveries)
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  return {
    delivered: results.length - failures.length,
    failed: failures.length,
    detail: failures.length ? failures.map((failure) => String(failure.reason instanceof Error ? failure.reason.message : failure.reason)).join(' · ').slice(0, 240) : null,
  }
}
