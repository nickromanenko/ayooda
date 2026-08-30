import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const inbox = readFileSync(new URL('../app/dashboard/inbox/page.tsx', import.meta.url), 'utf8')
const drawer = readFileSync(new URL('../components/dashboard/InboxCustomerDrawer.tsx', import.meta.url), 'utf8')
const overview = readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8')

test('Inbox exposes operator search, unread and assignment workflows', () => {
  assert.match(inbox, /Search conversations/)
  assert.match(inbox, /'unread', 'mine'/)
  assert.match(inbox, /\/assignee/)
  assert.match(inbox, /Assign conversation/)
})

test('internal notes stay visually distinct from customer replies', () => {
  assert.match(inbox, /\/notes/)
  assert.match(inbox, /Internal note/)
  assert.match(inbox, /Only teammates can see this/)
})

test('customer context supports exact conversation navigation', () => {
  assert.match(drawer, /Recent conversations/)
  assert.match(drawer, /onSelectConversation/)
  assert.match(overview, /inbox\?conversation=/)
})
