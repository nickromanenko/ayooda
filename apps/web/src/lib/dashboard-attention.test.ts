import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const attention = readFileSync(new URL('../components/dashboard/DashboardAttention.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../app/dashboard/layout.tsx', import.meta.url), 'utf8')

test('dashboard exposes a live attention center from desktop and mobile navigation', () => {
  assert.match(layout, /DashboardAttention/)
  assert.match(sidebar, /DASHBOARD_ATTENTION_EVENT/)
  assert.match(sidebar, /Needs attention/)
})

test('attention items link directly to waiting conversations and failing channels', () => {
  assert.match(attention, /conversations\?status=waiting/)
  assert.match(attention, /channels\/reliability/)
  assert.match(attention, /dashboard\/inbox\?conversation=/)
  assert.match(attention, /dashboard\/channels#channel-/)
})

test('attention center respects member access and keyboard dialog behavior', () => {
  assert.match(attention, /role === 'owner'/)
  assert.match(attention, /aria-modal="true"/)
  assert.match(attention, /event\.key === 'Escape'/)
  assert.match(attention, /event\.key !== 'Tab'/)
})
