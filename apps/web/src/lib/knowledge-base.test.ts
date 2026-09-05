import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { knowledgeBaseSearchText, normalizeDashboardHelpRoute } from './knowledge-base'

describe('dashboard knowledge base', () => {
  test('normalizes agent IDs while preserving the selected tab', () => {
    assert.equal(normalizeDashboardHelpRoute('/dashboard/agents/buZVCiaov3X4lstWHSmX/knowledge'), '/dashboard/agents/:agentId/knowledge')
    assert.equal(normalizeDashboardHelpRoute('/dashboard/agents/buZVCiaov3X4lstWHSmX'), '/dashboard/agents/:agentId')
  })

  test('keeps workspace routes and removes trailing slashes', () => {
    assert.equal(normalizeDashboardHelpRoute('/dashboard/inbox/'), '/dashboard/inbox')
    assert.equal(normalizeDashboardHelpRoute('/dashboard'), '/dashboard')
  })

  test('builds case-insensitive full-article search text', () => {
    const text = knowledgeBaseSearchText({
      title: 'Agent Knowledge', summary: 'Index documents', category: 'Agents', route: '/dashboard/agents/:agentId/knowledge',
      keywords: ['Auto-sync'], bodyMarkdown: 'Refresh stale websites.',
    })
    assert.match(text, /agent knowledge/)
    assert.match(text, /auto-sync/)
    assert.match(text, /refresh stale websites/)
  })
})
