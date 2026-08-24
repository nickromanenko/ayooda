import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const component = readFileSync(new URL('../components/providers/MixpanelAnalytics.tsx', import.meta.url), 'utf8')
const analytics = readFileSync(new URL('./product-analytics.ts', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')

test('Mixpanel initializes once on the client with EU ingestion and requested capture settings', () => {
  assert.match(component, /^'use client'/)
  assert.match(analytics, /8a369be75a1879a51cc7fd8a7f368284/)
  assert.match(analytics, /autocapture: true/)
  assert.match(analytics, /record_sessions_percent: 100/)
  assert.match(analytics, /api_host: 'https:\/\/api-eu\.mixpanel\.com'/)
  assert.match(analytics, /__ayoodaMixpanelInitialized/)
  assert.match(layout, /<MixpanelAnalytics \/>/)
})

test('product analytics defines the critical commercial funnel', () => {
  for (const event of [
    'Marketing CTA Clicked',
    'Sign Up Completed',
    'Agent Created',
    'Knowledge Source Added',
    'Agent Test Started',
    'Channel Connected',
    'Connector Installed',
    'MCP Server Connected',
    'Checkout Started',
    'Checkout Completed',
  ]) {
    assert.match(analytics, new RegExp(`'${event}'`))
  }
  assert.match(analytics, /mixpanel\.identify\(userId\)/)
  assert.match(analytics, /mixpanel\.reset\(\)/)
  assert.match(analytics, /transport: 'sendBeacon'/)
})

test('landing CTA tracking strips query strings from same-origin destinations', () => {
  assert.match(component, /destination\.pathname/)
  assert.doesNotMatch(component, /destination\.search/)
})
