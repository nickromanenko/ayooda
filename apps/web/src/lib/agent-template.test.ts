import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const form = readFileSync(new URL('../components/dashboard/NewAgentForm.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../../../api/src/routes/agents.ts', import.meta.url), 'utf8')

test('agent creation offers templates and an explicit blank starting point', () => {
  assert.match(form, /AGENT_TEMPLATES\.map/)
  assert.match(form, /Blank agent/)
  assert.match(form, /Knowledge, connections, channels, credentials, and deployment start empty/)
})

test('selected templates are applied by the trusted API and seed reusable configuration', () => {
  assert.match(form, /templateId/)
  assert.match(route, /isAgentTemplateId/)
  assert.match(route, /collection\('skills'\)/)
  assert.match(route, /collection\('workflowRules'\)/)
  assert.match(route, /collection\('evaluationCases'\)/)
})
