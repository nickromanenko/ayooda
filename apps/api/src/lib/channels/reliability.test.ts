import { expect, test } from 'bun:test'
import { reliabilityStatus, safeReliabilityDetail } from './reliability'
import { nextChannelIncidentState, validateChannelAlertSettings } from './alerts'

test('reliabilityStatus distinguishes unchecked, healthy, failing, and inactive channels', () => {
  expect(reliabilityStatus({})).toBe('unchecked')
  expect(reliabilityStatus({ lastSuccessAt: new Date() })).toBe('healthy')
  expect(reliabilityStatus({ lastSuccessAt: new Date(), consecutiveFailures: 2 })).toBe('failing')
  expect(reliabilityStatus({ lastFailureAt: new Date() })).toBe('failing')
  expect(reliabilityStatus({ isActive: false, lastSuccessAt: new Date() })).toBe('inactive')
})

test('safeReliabilityDetail normalizes and bounds provider errors', () => {
  expect(safeReliabilityDetail(new Error('bad\n  gateway'))).toBe('bad gateway')
  expect(safeReliabilityDetail('x'.repeat(300))).toHaveLength(240)
  expect(safeReliabilityDetail({ secret: 'do not serialize objects' })).toBe('Unknown error')
  expect(safeReliabilityDetail('Bearer secret-value failed at ?token=also-secret')).toBe('Bearer [redacted] failed at ?token=[redacted]')
  expect(safeReliabilityDetail('Slack rejected xoxb-123456-secret')).toBe('Slack rejected [redacted]')
})

test('channel incidents alert once at the threshold and once on recovery', () => {
  expect(nextChannelIncidentState({ outcome: 'failure', consecutiveFailures: 1, incidentOpen: false, threshold: 3 }))
    .toEqual({ consecutiveFailures: 2, incidentOpen: false, alertKind: null })
  expect(nextChannelIncidentState({ outcome: 'failure', consecutiveFailures: 2, incidentOpen: false, threshold: 3 }))
    .toEqual({ consecutiveFailures: 3, incidentOpen: true, alertKind: 'failure' })
  expect(nextChannelIncidentState({ outcome: 'failure', consecutiveFailures: 3, incidentOpen: true, threshold: 3 }))
    .toEqual({ consecutiveFailures: 4, incidentOpen: true, alertKind: null })
  expect(nextChannelIncidentState({ outcome: 'success', consecutiveFailures: 4, incidentOpen: true, threshold: 3 }))
    .toEqual({ consecutiveFailures: 0, incidentOpen: false, alertKind: 'recovery' })
  expect(nextChannelIncidentState({ outcome: 'success', consecutiveFailures: 0, incidentOpen: false, threshold: 3 }))
    .toEqual({ consecutiveFailures: 0, incidentOpen: false, alertKind: null })
})

test('channel alert settings require a bounded threshold and a usable destination', () => {
  expect(validateChannelAlertSettings(null).ok).toBe(false)
  expect(validateChannelAlertSettings({ enabled: true, threshold: 1, email: {}, slack: {} }).ok).toBe(false)
  expect(validateChannelAlertSettings({ enabled: true, threshold: 3, email: {}, slack: {} }).ok).toBe(false)
  expect(validateChannelAlertSettings({
    enabled: true,
    threshold: 3,
    email: { enabled: true, address: 'owner@example.com', transportChannelId: 'email-1' },
    slack: { enabled: false },
  })).toEqual({
    ok: true,
    value: {
      enabled: true,
      threshold: 3,
      email: { enabled: true, address: 'owner@example.com', transportChannelId: 'email-1' },
      slack: { enabled: false, destination: '', transportChannelId: '' },
    },
  })
  expect(validateChannelAlertSettings({
    enabled: true,
    threshold: 3,
    email: { enabled: false },
    slack: { enabled: true, destination: '#alerts', transportChannelId: 'slack-1' },
  }).ok).toBe(false)
})
