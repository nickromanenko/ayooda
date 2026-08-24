import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LANDING_LINKS } from './landing-links'

test('every advertised landing CTA has a real destination', () => {
  assert.deepEqual(LANDING_LINKS, {
    demo: '#demo',
    connectors: '/connectors',
    mcpDocs: '/docs/mcp',
    sandbox: '/signup',
  })
  assert.equal((Object.values(LANDING_LINKS) as string[]).includes('#'), false)
})
