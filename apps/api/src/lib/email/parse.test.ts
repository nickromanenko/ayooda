import { describe, expect, test } from 'bun:test'
import { bareAddress, cleanMessageId, parseReceivedEmail, replySubject, visitorIdForEmail, conversationIdForEmail, emailThreadKey } from './parse'

describe('bareAddress', () => {
  test('strips a display name', () => {
    expect(bareAddress('Acme <Support@Example.com>')).toBe('support@example.com')
  })
  test('passes through a bare address', () => {
    expect(bareAddress('user@example.com')).toBe('user@example.com')
  })
})

describe('cleanMessageId', () => {
  test('strips angle brackets', () => {
    expect(cleanMessageId('<abc@example.com>')).toBe('abc@example.com')
  })
})

describe('parseReceivedEmail', () => {
  test('extracts text, from, subject and threading', () => {
    const parsed = parseReceivedEmail({
      id: 'e1',
      from: 'Jane <jane@customer.com>',
      to: ['support@acme.com'],
      subject: 'Where is my order?',
      text: 'Hello!\nCan you help?',
      html: null,
      headers: { 'message-id': '<m1@acme.com>', 'in-reply-to': '<m0@acme.com>' },
    }, '<m1@acme.com>')
    expect(parsed.fromAddress).toBe('jane@customer.com')
    expect(parsed.toAddress).toBe('support@acme.com')
    expect(parsed.subject).toBe('Where is my order?')
    expect(parsed.text).toContain('Can you help?')
    expect(parsed.messageId).toBe('m1@acme.com')
    expect(parsed.inReplyTo).toBe('m0@acme.com')
  })

  test('falls back to stripping HTML when there is no text part', () => {
    const parsed = parseReceivedEmail({
      id: 'e1',
      from: 'jane@customer.com',
      to: ['support@acme.com'],
      subject: 'Hi',
      text: null,
      html: '<html><body><p>Hello <b>world</b></p></body></html>',
      headers: {},
    })
    expect(parsed.text).toBe('Hello world')
  })
})

describe('ids and subjects', () => {
  test('thread key prefers the in-reply-to id', () => {
    expect(emailThreadKey('parent@acme.com', 'child@acme.com')).toBe('parent@acme.com')
  })
  test('conversation id is stable and prefixed', () => {
    const a = conversationIdForEmail('thread@acme.com')
    expect(a.startsWith('email_')).toBe(true)
    expect(a).toBe(conversationIdForEmail('thread@acme.com'))
  })
  test('visitor id is prefixed and lowercased', () => {
    expect(visitorIdForEmail('Jane@Customer.com')).toBe('email_jane@customer.com')
  })
  test('reply subject avoids double Re:', () => {
    expect(replySubject('Where is my order?')).toBe('Re: Where is my order?')
    expect(replySubject('Re: Where is my order?')).toBe('Re: Where is my order?')
  })
})
