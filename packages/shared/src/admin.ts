import type { PlanTier, SubscriptionStatus } from './plans'

export type PlatformRole = 'admin'
export type UserAccessStatus = 'active' | 'disabled'

export interface AdminUserSummary {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  workspaceId: string
  workspaceName: string
  workspaceRole: 'owner' | 'member'
  platformRole: PlatformRole | null
  accessStatus: UserAccessStatus
  createdAt: string | null
  updatedAt: string | null
  lastSignInAt: string | null
}

export interface AdminWorkspaceSummary {
  id: string
  name: string
  ownerId: string
  ownerEmail: string
  onboardingComplete: boolean
  subscriptionStatus: SubscriptionStatus | null
  tier: PlanTier | null
  periodConversationCount: number
  tokenCount: number
  createdAt: string | null
}

export interface AdminWorkspaceDetail extends AdminWorkspaceSummary {
  members: Array<Pick<AdminUserSummary, 'uid' | 'email' | 'displayName' | 'workspaceRole' | 'accessStatus'>>
  counts: {
    members: number
    agents: number
    channels: number
    conversations: number
    tickets: number
  }
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface AdminOverviewMetric {
  value: number | null
  unavailable?: boolean
}

export interface AdminOverview {
  metrics: {
    users: AdminOverviewMetric
    workspaces: AdminOverviewMetric
    signups7d: AdminOverviewMetric
    signups30d: AdminOverviewMetric
    activeSubscriptions: AdminOverviewMetric
    trialingSubscriptions: AdminOverviewMetric
    pastDueSubscriptions: AdminOverviewMetric
    periodConversations: AdminOverviewMetric
    totalTokens: AdminOverviewMetric
  }
  recentUsers: AdminUserSummary[]
  recentWorkspaces: AdminWorkspaceSummary[]
}

export interface AdminAuditEvent {
  id: string
  actorUid: string
  actorEmail: string
  action: string
  targetType: 'user' | 'workspace' | 'platform_role'
  targetId: string
  outcome: 'succeeded' | 'failed'
  summary: string
  metadata: Record<string, string | number | boolean | null>
  createdAt: string | null
}

export interface AdminListResponse<T> {
  items: T[]
  nextCursor: string | null
}
