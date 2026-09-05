import type { AdminAuditEvent, AdminUserSummary, AdminWorkspaceSummary } from '@ayooda/shared'

export function adminIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return null
}

export function serializeAdminUser(
  id: string,
  data: FirebaseFirestore.DocumentData,
  workspaceName = '',
  auth?: { disabled?: boolean; lastSignInTime?: string | null },
): AdminUserSummary {
  return {
    uid: id,
    email: String(data.email ?? ''),
    displayName: String(data.displayName ?? ''),
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    workspaceId: String(data.workspaceId ?? ''),
    workspaceName,
    workspaceRole: data.role === 'member' ? 'member' : 'owner',
    platformRole: data.platformRole === 'admin' ? 'admin' : null,
    accessStatus: data.accessStatus === 'disabled' || auth?.disabled ? 'disabled' : 'active',
    createdAt: adminIso(data.createdAt),
    updatedAt: adminIso(data.updatedAt),
    lastSignInAt: adminIso(auth?.lastSignInTime),
  }
}

export function serializeAdminWorkspace(
  id: string,
  data: FirebaseFirestore.DocumentData,
  ownerEmail = '',
): AdminWorkspaceSummary {
  const subscription = data.subscription ?? {}
  const usage = data.usage ?? {}
  const allowedStatuses = new Set(['trialing', 'active', 'past_due', 'canceled', 'expired'])
  const allowedTiers = new Set(['lite', 'core', 'max'])
  return {
    id,
    name: String(data.name ?? 'Untitled workspace'),
    ownerId: String(data.ownerId ?? ''),
    ownerEmail,
    onboardingComplete: data.onboardingComplete === true,
    subscriptionStatus: allowedStatuses.has(subscription.status) ? subscription.status : null,
    tier: allowedTiers.has(subscription.tier) ? subscription.tier : null,
    periodConversationCount: Number(usage.periodConversationCount ?? 0),
    tokenCount: Number(usage.tokenCount ?? 0),
    createdAt: adminIso(data.createdAt),
  }
}

export function serializeAdminAudit(id: string, data: FirebaseFirestore.DocumentData): AdminAuditEvent {
  return {
    id,
    actorUid: String(data.actorUid ?? ''),
    actorEmail: String(data.actorEmail ?? ''),
    action: String(data.action ?? ''),
    targetType: data.targetType === 'workspace' || data.targetType === 'platform_role' ? data.targetType : 'user',
    targetId: String(data.targetId ?? ''),
    outcome: data.outcome === 'failed' ? 'failed' : 'succeeded',
    summary: String(data.summary ?? ''),
    metadata: typeof data.metadata === 'object' && data.metadata ? data.metadata : {},
    createdAt: adminIso(data.createdAt),
  }
}
