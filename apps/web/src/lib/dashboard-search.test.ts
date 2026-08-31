import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const search = readFileSync(new URL('../components/dashboard/DashboardSearch.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../app/dashboard/layout.tsx', import.meta.url), 'utf8')

test('global dashboard search is reachable by button and keyboard', () => {
  assert.match(layout, /DashboardSearch/)
  assert.match(sidebar, /DASHBOARD_SEARCH_EVENT/)
  assert.match(search, /event\.metaKey \|\| event\.ctrlKey/)
  assert.match(search, /event\.key === '\/'/)
})

test('search supports accessible keyboard navigation and direct results', () => {
  assert.match(search, /aria-activedescendant/)
  assert.match(search, /ArrowDown/)
  assert.match(search, /ArrowUp/)
  assert.match(search, /dashboard\/inbox\?conversation=/)
  assert.match(search, /AGENT_AREAS/)
})

test('members receive a restricted navigation catalogue', () => {
  assert.match(search, /MEMBER_PAGES/)
  assert.match(search, /hasAgentAccess/)
})
