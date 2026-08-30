import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const component = readFileSync(new URL('../app/dashboard/agents/[agentId]/AgentVersionHistory.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/dashboard/agents/[agentId]/page.tsx', import.meta.url), 'utf8')

test('agent editor exposes restorable configuration history', () => {
  assert.match(page, /AgentVersionHistory/)
  assert.match(component, /\/versions\/\$\{version\.id\}\/restore/)
  assert.match(component, /current configuration will remain available in history/i)
})

test('history clearly scopes what restore changes', () => {
  assert.match(component, /Knowledge, tools, workflows, and channels are unchanged/)
  assert.match(component, /name, description, instructions, role, and model/i)
})

test('agent drafts are distinguished from persisted configuration', () => {
  assert.match(page, /hasUnsavedChanges/)
  assert.match(page, /beforeunload/)
  assert.match(page, /current=\{savedAgent \?\? agent\}/)
})
