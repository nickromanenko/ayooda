import { Hono } from 'hono'
import type { DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { prepareTurn } from '../lib/chat/agent-turn'
import { runAgentTurn } from '../lib/chat/tools'
import {
  EVALUATION_CASE_LIMIT,
  EVALUATION_RESPONSE_MAX,
  EVALUATION_RUN_CASE_LIMIT,
  scoreEvaluation,
  validateEvaluationCase,
  type EvaluationCaseInput,
} from '../lib/evaluations'
import { sandboxSessionPath } from '../lib/chat/sandbox-session'
import { rateLimit } from '../lib/rate-limit'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { requireAgent } from '../middleware/agent'

const evaluations = new Hono<{ Variables: AuthVariables }>()
evaluations.use('*', requireAuth)
evaluations.use('*', requireAgent)

const casesPath = (workspaceId: string, agentId: string) =>
  `workspaces/${workspaceId}/agents/${agentId}/evaluationCases`
const runsPath = (workspaceId: string, agentId: string) =>
  `workspaces/${workspaceId}/agents/${agentId}/evaluationRuns`

function asIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

function serializeCase(id: string, data: DocumentData) {
  return {
    id,
    name: String(data.name ?? ''),
    prompt: String(data.prompt ?? ''),
    expectedIncludes: Array.isArray(data.expectedIncludes) ? data.expectedIncludes : [],
    forbiddenIncludes: Array.isArray(data.forbiddenIncludes) ? data.forbiddenIncludes : [],
    expectedOutcome: data.expectedOutcome ?? 'answer',
    enabled: data.enabled !== false,
    createdAt: asIso(data.createdAt),
    updatedAt: asIso(data.updatedAt),
  }
}

function serializeRun(id: string, data: DocumentData) {
  return {
    id,
    status: data.status ?? 'complete',
    total: Number(data.total ?? 0),
    passed: Number(data.passed ?? 0),
    durationMs: Number(data.durationMs ?? 0),
    results: Array.isArray(data.results) ? data.results : [],
    createdAt: asIso(data.createdAt),
  }
}

evaluations.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const [caseSnap, runSnap] = await Promise.all([
    adminDb.collection(casesPath(workspaceId, agentId)).orderBy('createdAt', 'asc').get(),
    adminDb.collection(runsPath(workspaceId, agentId)).orderBy('createdAt', 'desc').limit(10).get(),
  ])
  return c.json({
    cases: caseSnap.docs.map((doc) => serializeCase(doc.id, doc.data())),
    runs: runSnap.docs.map((doc) => serializeRun(doc.id, doc.data())),
  })
})

evaluations.post('/cases', async (c) => {
  const parsed = validateEvaluationCase(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const col = adminDb.collection(casesPath(c.get('workspaceId'), c.get('agentId')!))
  if ((await col.count().get()).data().count >= EVALUATION_CASE_LIMIT) {
    return c.json({ error: `A suite can contain up to ${EVALUATION_CASE_LIMIT} tests.` }, 400)
  }
  const now = new Date()
  const data = { ...parsed.value, createdAt: now, updatedAt: now }
  const ref = await col.add(data)
  return c.json(serializeCase(ref.id, data), 201)
})

evaluations.put('/cases/:caseId', async (c) => {
  const parsed = validateEvaluationCase(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const ref = adminDb.doc(`${casesPath(c.get('workspaceId'), c.get('agentId')!)}/${c.req.param('caseId')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Test not found.' }, 404)
  const data = { ...parsed.value, updatedAt: new Date() }
  await ref.update(data)
  return c.json(serializeCase(ref.id, { ...data }))
})

evaluations.delete('/cases/:caseId', async (c) => {
  await adminDb.doc(`${casesPath(c.get('workspaceId'), c.get('agentId')!)}/${c.req.param('caseId')}`).delete()
  return c.json({ ok: true })
})

async function executeCase(args: {
  workspaceId: string
  agentId: string
  uid: string
  runId: string
  caseId: string
  testCase: EvaluationCaseInput & { name: string }
}) {
  const started = Date.now()
  const sessionId = `eval_${args.runId}_${args.caseId}`
  let response = ''
  let actualOutcome: 'answer' | 'handoff' | 'silent' = 'answer'
  let error: string | null = null
  try {
    const prepared = await prepareTurn({
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      channelId: 'evaluation',
      channelType: 'sandbox',
      conversationId: sessionId,
      visitorId: `evaluation_${args.uid}_${args.agentId}`,
      message: args.testCase.prompt,
      sandbox: { ownerUid: args.uid, allowTools: false },
    })
    if (prepared.kind === 'gated') throw new Error('An active plan or trial is required to run evaluations.')
    if (prepared.kind === 'error') throw new Error(prepared.error)
    if (prepared.kind === 'silent') {
      actualOutcome = 'silent'
    } else if (prepared.kind === 'workflow') {
      response = prepared.message
      actualOutcome = prepared.status === 'waiting' || prepared.status === 'human' ? 'handoff' : 'answer'
    } else {
      const gen = runAgentTurn(prepared.chatParams, prepared.tools, prepared.trace, {}, prepared.skillTools, prepared.mcpTools)
      let promptTokens = 0
      let completionTokens = 0
      while (true) {
        const next = await gen.next()
        if (next.done) {
          promptTokens = next.value.promptTokens
          completionTokens = next.value.completionTokens
          break
        }
        response += next.value.text
      }
      response = [prepared.prefix, response.trim()].filter(Boolean).join('\n\n')
      await prepared.persist(response, promptTokens, completionTokens)
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Evaluation failed.'
  } finally {
    await adminDb.recursiveDelete(adminDb.doc(sandboxSessionPath(args.workspaceId, args.uid, sessionId))).catch(() => {})
  }
  const score = error
    ? { passed: false, checks: [{ label: 'Agent completed the test', passed: false }] }
    : scoreEvaluation(args.testCase, response, actualOutcome)
  return {
    caseId: args.caseId,
    name: args.testCase.name,
    prompt: args.testCase.prompt,
    response: response.slice(0, EVALUATION_RESPONSE_MAX),
    actualOutcome,
    passed: score.passed,
    checks: score.checks,
    error,
    durationMs: Date.now() - started,
  }
}

evaluations.post('/runs', async (c) => {
  const workspaceId = c.get('workspaceId')
  const agentId = c.get('agentId')!
  const uid = c.get('uid')
  const limited = rateLimit(`evaluations:${uid}:${agentId}`, 3, 60_000)
  if (!limited.ok) {
    c.header('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)))
    return c.json({ error: 'Too many evaluation runs. Please wait a moment.' }, 429)
  }
  const body: { caseIds?: unknown } = await c.req.json<{ caseIds?: unknown }>().catch(() => ({}))
  const requested = Array.isArray(body.caseIds) && body.caseIds.every((id: unknown) => typeof id === 'string')
    ? new Set(body.caseIds as string[])
    : null
  const caseSnap = await adminDb.collection(casesPath(workspaceId, agentId)).orderBy('createdAt', 'asc').get()
  const selected = caseSnap.docs
    .map((doc) => serializeCase(doc.id, doc.data()))
    .filter((testCase) => testCase.enabled && (!requested || requested.has(testCase.id)))
  if (selected.length === 0) return c.json({ error: 'Enable at least one test before running the suite.' }, 400)
  if (selected.length > EVALUATION_RUN_CASE_LIMIT) {
    return c.json({ error: `Run up to ${EVALUATION_RUN_CASE_LIMIT} tests at a time.` }, 400)
  }

  const runRef = adminDb.collection(runsPath(workspaceId, agentId)).doc()
  const started = Date.now()
  // Keep the request comfortably shorter than a fully sequential batch without
  // creating a burst large enough to overwhelm the configured model provider.
  const results: Awaited<ReturnType<typeof executeCase>>[] = new Array(selected.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (cursor < selected.length) {
      const index = cursor++
      const testCase = selected[index]!
      results[index] = await executeCase({
        workspaceId, agentId, uid, runId: runRef.id, caseId: testCase.id,
        testCase: testCase as EvaluationCaseInput & { name: string },
      })
    }
  })
  await Promise.all(workers)
  const data = {
    status: 'complete',
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    durationMs: Date.now() - started,
    results,
    createdBy: uid,
    createdAt: new Date(),
  }
  await runRef.set(data)
  return c.json(serializeRun(runRef.id, data), 201)
})

export default evaluations
