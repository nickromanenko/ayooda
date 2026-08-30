import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const dialog = readFileSync(new URL('../app/dashboard/agents/[agentId]/DuplicateAgentDialog.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/dashboard/agents/[agentId]/page.tsx', import.meta.url), 'utf8')

test('owners can open a scoped agent duplication flow', () => {
  assert.match(page, /DuplicateAgentDialog/)
  assert.match(dialog, /copyTools/)
  assert.match(dialog, /copySkills/)
  assert.match(dialog, /copyWorkflows/)
  assert.match(dialog, /copyTests/)
})

test('duplication clearly identifies data that always starts fresh', () => {
  assert.match(dialog, /Knowledge, channels, conversations, usage, agent photo, team access, and model-provider keys are not copied/)
})
