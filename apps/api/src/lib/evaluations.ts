export const EVALUATION_CASE_LIMIT = 50
export const EVALUATION_RUN_CASE_LIMIT = 10
export const EVALUATION_RESPONSE_MAX = 12_000

export type EvaluationOutcome = 'any' | 'answer' | 'handoff' | 'silent'

export type EvaluationCaseInput = {
  name: string
  prompt: string
  expectedIncludes: string[]
  forbiddenIncludes: string[]
  expectedOutcome: EvaluationOutcome
  enabled: boolean
}

export type EvaluationCheck = {
  label: string
  passed: boolean
}

function cleanStringList(value: unknown, field: string): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { ok: false, error: `${field} must be a list of text values.` }
  }
  const cleaned = [...new Set(value.map((item) => item.trim()).filter(Boolean))]
  if (cleaned.length > 10) return { ok: false, error: `${field} supports up to 10 values.` }
  if (cleaned.some((item) => item.length > 200)) return { ok: false, error: `${field} values must be 200 characters or fewer.` }
  return { ok: true, value: cleaned }
}

export function validateEvaluationCase(raw: unknown):
  | { ok: true; value: EvaluationCaseInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request body.' }
  const body = raw as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!name) return { ok: false, error: 'Test name is required.' }
  if (name.length > 100) return { ok: false, error: 'Test name must be 100 characters or fewer.' }
  if (!prompt) return { ok: false, error: 'Customer message is required.' }
  if (prompt.length > 5_000) return { ok: false, error: 'Customer message must be 5,000 characters or fewer.' }

  const expectedIncludes = cleanStringList(body.expectedIncludes, 'Must mention')
  if (!expectedIncludes.ok) return expectedIncludes
  const forbiddenIncludes = cleanStringList(body.forbiddenIncludes, 'Must avoid')
  if (!forbiddenIncludes.ok) return forbiddenIncludes
  const expectedOutcome = body.expectedOutcome ?? 'answer'
  if (!['any', 'answer', 'handoff', 'silent'].includes(String(expectedOutcome))) {
    return { ok: false, error: 'Expected behavior is invalid.' }
  }
  if (expectedOutcome === 'any' && expectedIncludes.value.length === 0 && forbiddenIncludes.value.length === 0) {
    return { ok: false, error: 'Add at least one content check or choose an expected behavior.' }
  }
  return {
    ok: true,
    value: {
      name,
      prompt,
      expectedIncludes: expectedIncludes.value,
      forbiddenIncludes: forbiddenIncludes.value,
      expectedOutcome: expectedOutcome as EvaluationOutcome,
      enabled: body.enabled !== false,
    },
  }
}

export function scoreEvaluation(
  input: Pick<EvaluationCaseInput, 'expectedIncludes' | 'forbiddenIncludes' | 'expectedOutcome'>,
  response: string,
  actualOutcome: Exclude<EvaluationOutcome, 'any'>,
): { passed: boolean; checks: EvaluationCheck[] } {
  const normalized = response.toLowerCase()
  const checks: EvaluationCheck[] = []
  if (input.expectedOutcome !== 'any') {
    const labels: Record<Exclude<EvaluationOutcome, 'any'>, string> = {
      answer: 'Agent answers the customer',
      handoff: 'Agent hands off to a human',
      silent: 'Workflow stops without a reply',
    }
    checks.push({ label: labels[input.expectedOutcome], passed: actualOutcome === input.expectedOutcome })
  }
  for (const value of input.expectedIncludes) {
    checks.push({ label: `Mentions “${value}”`, passed: normalized.includes(value.toLowerCase()) })
  }
  for (const value of input.forbiddenIncludes) {
    checks.push({ label: `Avoids “${value}”`, passed: !normalized.includes(value.toLowerCase()) })
  }
  return { passed: checks.every((check) => check.passed), checks }
}
