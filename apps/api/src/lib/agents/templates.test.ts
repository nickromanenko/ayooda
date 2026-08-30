import { describe, expect, test } from 'bun:test'
import { AGENT_TEMPLATES } from '@ayooda/shared'
import { validateEvaluationCase } from '../evaluations'
import { validateRule } from '../workflow/validate'

describe('agent template seed data', () => {
  test('every workflow rule is accepted by the production validator', () => {
    for (const template of AGENT_TEMPLATES) {
      for (const rule of template.rules) {
        expect(validateRule({ name: rule.name, enabled: true, trigger: rule.trigger, action: rule.action }).ok).toBe(true)
      }
    }
  })

  test('every regression case is accepted by the production validator', () => {
    for (const template of AGENT_TEMPLATES) {
      for (const testCase of template.tests) expect(validateEvaluationCase({ ...testCase, enabled: true }).ok).toBe(true)
    }
  })
})
