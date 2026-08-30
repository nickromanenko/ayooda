import { describe, expect, test } from 'bun:test'
import { scoreEvaluation, validateEvaluationCase } from './evaluations'

describe('validateEvaluationCase', () => {
  test('normalizes a useful case', () => {
    const result = validateEvaluationCase({
      name: ' Pricing ', prompt: ' What does it cost? ', expectedIncludes: ['plan', 'plan'],
      forbiddenIncludes: ['guaranteed'], expectedOutcome: 'answer',
    })
    expect(result).toEqual({ ok: true, value: {
      name: 'Pricing', prompt: 'What does it cost?', expectedIncludes: ['plan'], forbiddenIncludes: ['guaranteed'],
      expectedOutcome: 'answer', enabled: true,
    } })
  })

  test('rejects a case without a measurable expectation', () => {
    expect(validateEvaluationCase({ name: 'Empty', prompt: 'Hello', expectedOutcome: 'any' })).toEqual({
      ok: false, error: 'Add at least one content check or choose an expected behavior.',
    })
  })
})

describe('scoreEvaluation', () => {
  test('scores behavior and content checks case-insensitively', () => {
    expect(scoreEvaluation({ expectedOutcome: 'answer', expectedIncludes: ['Pro Plan'], forbiddenIncludes: ['guaranteed'] }, 'Our PRO PLAN may fit.', 'answer')).toEqual({
      passed: true,
      checks: [
        { label: 'Agent answers the customer', passed: true },
        { label: 'Mentions “Pro Plan”', passed: true },
        { label: 'Avoids “guaranteed”', passed: true },
      ],
    })
  })

  test('fails when a forbidden claim is present', () => {
    const result = scoreEvaluation({ expectedOutcome: 'handoff', expectedIncludes: [], forbiddenIncludes: ['refund'] }, 'I can issue a refund.', 'answer')
    expect(result.passed).toBe(false)
    expect(result.checks.map((check) => check.passed)).toEqual([false, false])
  })
})
