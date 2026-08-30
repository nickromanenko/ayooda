import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const overview = readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8')
const checklist = readFileSync(new URL('../components/dashboard/ActivationChecklist.tsx', import.meta.url), 'utf8')

test('Overview guides users through the full launch workflow', () => {
  for (const label of ['Configure identity', 'Index trusted knowledge', 'Pass regression tests', 'Configure human hand-off', 'Launch a channel']) {
    assert.match(overview, new RegExp(label))
  }
  assert.match(overview, /lastSeenAt/)
})

test('activation checklist prioritizes the first incomplete step', () => {
  assert.match(checklist, /steps\.find\(\(step\) => !step\.done\)/)
  assert.match(checklist, /Next:/)
  assert.match(checklist, /progressTrack/)
})
