import { describe, expect, test } from 'bun:test'
import {
  isKnowledgeSyncInterval,
  knowledgeSyncLeaseUntil,
  knowledgeSyncRetryAt,
  nextKnowledgeSyncAt,
} from './knowledge-sync'

const now = new Date('2026-08-23T12:00:00.000Z')

describe('knowledge sync scheduling', () => {
  test('accepts only supported intervals', () => {
    expect(isKnowledgeSyncInterval(24)).toBe(true)
    expect(isKnowledgeSyncInterval(168)).toBe(true)
    expect(isKnowledgeSyncInterval(720)).toBe(true)
    expect(isKnowledgeSyncInterval(12)).toBe(false)
    expect(isKnowledgeSyncInterval('24')).toBe(false)
  })

  test('schedules the next successful sync from completion time', () => {
    expect(nextKnowledgeSyncAt(now, 168).toISOString()).toBe('2026-08-30T12:00:00.000Z')
  })

  test('uses a one-hour lease while a sync is running', () => {
    expect(knowledgeSyncLeaseUntil(now).toISOString()).toBe('2026-08-23T13:00:00.000Z')
  })

  test('backs off failures and caps retries at 24 hours', () => {
    expect(knowledgeSyncRetryAt(now, 1).toISOString()).toBe('2026-08-23T13:00:00.000Z')
    expect(knowledgeSyncRetryAt(now, 4).toISOString()).toBe('2026-08-23T20:00:00.000Z')
    expect(knowledgeSyncRetryAt(now, 99).toISOString()).toBe('2026-08-24T12:00:00.000Z')
  })
})
