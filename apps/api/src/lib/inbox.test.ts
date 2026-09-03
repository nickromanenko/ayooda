import { describe, expect, test } from 'bun:test'
import { inboxCustomerIdentity, matchesInboxSearch } from './inbox'

describe('Inbox helpers', () => {
  test('searches customer identifiers, summaries, subjects, and message previews', () => {
    const row = { visitorId: 'email_jane@example.com', emailSubject: 'Refund request', lastMessage: 'Where is my order?' }
    expect(matchesInboxSearch(row, 'jane refund')).toBe(true)
    expect(matchesInboxSearch(row, 'order')).toBe(true)
    expect(matchesInboxSearch(row, 'cancellation')).toBe(false)
  })

  test('derives useful customer labels without exposing channel credentials', () => {
    expect(inboxCustomerIdentity({ visitorId: 'email_jane@example.com' })).toEqual({
      label: 'jane@example.com', email: 'jane@example.com', phone: null, externalId: 'email_jane@example.com',
    })
    expect(inboxCustomerIdentity({ visitorId: 'sms_+15551234567', smsFrom: '+15551234567' }).label).toBe('+15551234567')
    expect(inboxCustomerIdentity({
      visitorId: 'auth_opaque', customerName: 'Ada Lovelace', customerEmail: 'ada@example.com', customerExternalId: 'customer-42',
    })).toEqual({ label: 'Ada Lovelace', email: 'ada@example.com', phone: null, externalId: 'customer-42' })
    expect(matchesInboxSearch({ visitorId: 'auth_opaque', customerName: 'Ada Lovelace', customerExternalId: 'customer-42' }, 'ada 42')).toBe(true)
  })
})
