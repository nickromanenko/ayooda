import { describe, expect, test } from 'bun:test'
import { serializeAdminUser, serializeAdminWorkspace } from './serialize'

describe('admin serializers', () => {
  test('return allowlisted user fields and fail closed on role values', () => {
    const value = serializeAdminUser('u1', {
      email: 'a@example.com', workspaceId: 'w1', role: 'unexpected', platformRole: 'root',
      openRouterKey: 'secret', accessStatus: 'disabled', createdAt: new Date('2026-01-01T00:00:00Z'),
    }, 'Acme')
    expect(value.workspaceRole).toBe('owner')
    expect(value.platformRole).toBeNull()
    expect(value.accessStatus).toBe('disabled')
    expect(value).not.toHaveProperty('openRouterKey')
  })

  test('returns a safe workspace summary without secrets', () => {
    const value = serializeAdminWorkspace('w1', {
      name: 'Acme', ownerId: 'u1', openRouterKey: 'secret',
      subscription: { status: 'active', tier: 'core', stripeCustomerId: 'cus_secret' },
      usage: { periodConversationCount: 12, tokenCount: 300 },
    }, 'owner@example.com')
    expect(value.subscriptionStatus).toBe('active')
    expect(value.periodConversationCount).toBe(12)
    expect(value).not.toHaveProperty('openRouterKey')
    expect(value).not.toHaveProperty('stripeCustomerId')
  })
})
