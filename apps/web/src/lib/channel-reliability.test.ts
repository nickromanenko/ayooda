import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = readFileSync(new URL('../app/dashboard/channels/page.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../app/dashboard/channels/page.module.css', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/dashboard/Sidebar.tsx', import.meta.url), 'utf8')

test('channel health is reachable and backed by reliability APIs', () => {
  assert.match(sidebar, /Channel health.*\/dashboard\/channels/)
  assert.match(page, /apiRequest\('\/channels\/reliability'\)/)
  assert.match(page, /`\/channels\/\$\{channelId\}\/diagnose`/)
  assert.match(page, /Run all checks/)
})

test('channel health stays responsive and uses accessible control sizes', () => {
  assert.match(styles, /\.button \{[^}]*min-height: 40px;/)
  assert.match(styles, /\.checkButton \{[^}]*min-height: 40px;/)
  const tabletRules = styles.match(/@media \(max-width: 840px\) \{([^\n]*)\}/)?.[1] ?? ''
  assert.match(tabletRules, /\.grid \{ grid-template-columns: 1fr;/)
})
