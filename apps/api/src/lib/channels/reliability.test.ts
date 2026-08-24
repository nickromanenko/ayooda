import { expect, test } from 'bun:test'
import { reliabilityStatus, safeReliabilityDetail } from './reliability'

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
