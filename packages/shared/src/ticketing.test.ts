import { describe, expect, test } from 'bun:test'
import { DEFAULT_TICKETING_CONFIG, validateTicketingConfig, validateTicketSubmission } from './ticketing'

describe('ticketing validation', () => {
  test('accepts a safe internal configuration', () => {
    expect(validateTicketingConfig(DEFAULT_TICKETING_CONFIG).ok).toBe(true)
  })

  test('rejects insecure webhooks and duplicate custom fields', () => {
    expect(validateTicketingConfig({ ...DEFAULT_TICKETING_CONFIG, destination: { type: 'webhook', url: 'http://example.com' } }).ok).toBe(false)
    expect(validateTicketingConfig({ ...DEFAULT_TICKETING_CONFIG, fields: [
      { id: 'order_id', label: 'Order', description: '', type: 'text', required: true },
      { id: 'order_id', label: 'Order again', description: '', type: 'text', required: false },
    ] }).ok).toBe(false)
  })

  test('enforces confirmation and configured required fields', () => {
    const config = { ...DEFAULT_TICKETING_CONFIG, enabled: true, fields: [{ id: 'order_id', label: 'Order ID', description: '', type: 'text' as const, required: true }] }
    expect(validateTicketSubmission({ subject: 'Help', description: 'Details', priority: 'normal', customerConfirmed: false, fields: { order_id: 'A1' } }, config).ok).toBe(false)
    expect(validateTicketSubmission({ subject: 'Help', description: 'Details', priority: 'normal', customerConfirmed: true, fields: {} }, config).ok).toBe(false)
    expect(validateTicketSubmission({ subject: 'Help', description: 'Details', priority: 'normal', customerConfirmed: true, fields: { order_id: 'A1' } }, config).ok).toBe(true)
  })
})
