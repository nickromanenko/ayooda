import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The auto-close reopen path, end to end through prepareTurn.
 *
 * The sweep resolves idle `bot` conversations, and the widget keeps the same conversationId in
 * sessionStorage — so without the reopen a visitor who leaves the tab open for 30 minutes and
 * comes back is silenced forever. The operator-resolved path must keep going silent exactly as
 * it always has, which is the other half of every test here.
 */

// ---------------------------------------------------------------------------
// Minimal in-memory Firestore: enough for prepareTurn's doc reads/writes. Every
// query returns empty, so agent resolution falls back to the inline workspace agent
// and there are no workflow rules, tools or skills in play.
// ---------------------------------------------------------------------------
const state = {
  docs: new Map<string, Record<string, any>>(),
  updates: [] as Array<{ path: string; data: Record<string, any> }>,
  added: [] as Array<{ path: string; data: Record<string, any> }>,
}

const emptyQuery = { docs: [] as unknown[], empty: true, size: 0 }

const queryRef = (path: string): any => ({
  where: () => queryRef(path),
  orderBy: () => queryRef(path),
  limit: () => queryRef(path),
  limitToLast: () => queryRef(path),
  get: async () => emptyQuery,
})

const docRef = (path: string): any => ({
  path,
  id: path.split('/').pop(),
  get: async () => {
    const data = state.docs.get(path)
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, ref: docRef(path) }
  },
  set: async (data: Record<string, any>) => { state.docs.set(path, data) },
  update: async (data: Record<string, any>) => {
    state.updates.push({ path, data })
    state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data })
  },
  collection: (id: string) => collRef(`${path}/${id}`),
})

const collRef = (path: string): any => ({
  ...queryRef(path),
  doc: (id: string) => docRef(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    state.added.push({ path, data })
    return { id: `m${state.added.length}` }
  },
})

const adminDb = { doc: docRef, collection: collRef }
const traceStub: any = { span: () => ({ end: () => {} }), update: () => {}, generation: () => ({ end: () => {} }) }

mock.module('../firebase-admin', () => ({ adminDb, adminAuth: {}, adminBucket: () => ({}) }))
mock.module('../langfuse', () => ({ getLangfuse: () => ({ trace: () => traceStub }) }))
mock.module('../gemini', () => ({ LEGACY_MODEL_MAP: {}, embedText: async () => [0.1, 0.2] }))
mock.module('../pinecone', () => ({ namespaceFor: () => ({ query: async () => ({ matches: [] }) }) }))
mock.module('../llm/resolve', () => ({ resolveGatewayKey: () => ({ ok: true, apiKey: 'k' }) }))

const { prepareTurn, evaluateSilenceGate } = await import('./agent-turn')

const CONV = 'workspaces/w/conversations/c'

const seed = (conversation: Record<string, any>) => {
  state.docs.clear()
  state.updates = []
  state.added = []
  state.docs.set('workspaces/w', {
    createdAt: new Date('2026-01-01T00:00:00Z'),
    subscription: { tier: 'core', status: 'active' },
    agent: { systemPrompt: 'You are helpful.', llmModel: 'google/gemini-2.5-flash' },
    gatewayKey: 'enc',
  })
  state.docs.set(CONV, conversation)
}

const turn = () =>
  prepareTurn({
    workspaceId: 'w', channelId: 'ch', conversationId: 'c', visitorId: 'v',
    message: 'are you still there?', channelType: 'web_widget',
  })

const reopenUpdate = () => state.updates.find((u) => u.path === CONV && u.data.status === 'bot')

describe('prepareTurn silence guard', () => {
  beforeEach(() => { state.updates = []; state.added = [] })

  test('a conversation WE auto-closed reopens and still gets a reply', async () => {
    seed({ visitorId: 'v', status: 'resolved', autoClosedAt: new Date(), pendingPostProcess: true, scoredAt: new Date() })
    const result = await turn()
    expect(result.kind).toBe('ready')

    const update = reopenUpdate()
    expect(update).toBeDefined()
    // Every field describing the closed state is cleared, so the conversation behaves like a
    // live one and its eventual re-close scores the whole transcript, not just the first half.
    expect(update!.data.autoClosedAt).toEqual(FieldValue.delete())
    expect(update!.data.pendingPostProcess).toEqual(FieldValue.delete())
    expect(update!.data.postProcessedAt).toEqual(FieldValue.delete())
    expect(update!.data.scoredAt).toEqual(FieldValue.delete())
  })

  test('a conversation a HUMAN resolved stays silent — unchanged behaviour', async () => {
    seed({ visitorId: 'v', status: 'resolved' })
    const result = await turn()
    expect(result.kind).toBe('silent')
    expect(reopenUpdate()).toBeUndefined()
    // The visitor's message is still recorded for the operator to read.
    expect(state.added.some((a) => a.path === `${CONV}/messages`)).toBe(true)
  })

  test('a conversation assigned to an operator stays silent', async () => {
    seed({ visitorId: 'v', status: 'assigned', operatorId: 'op1' })
    expect((await turn()).kind).toBe('silent')
    expect(reopenUpdate()).toBeUndefined()
  })

  test('a live bot conversation is untouched and answered', async () => {
    seed({ visitorId: 'v', status: 'bot' })
    expect((await turn()).kind).toBe('ready')
    expect(reopenUpdate()).toBeUndefined()
  })
})

describe('evaluateSilenceGate', () => {
  test('auto-closed reopens; operator-resolved goes silent; bot proceeds', () => {
    expect(evaluateSilenceGate({ status: 'resolved', autoClosedAt: new Date() }).kind).toBe('reopen')
    expect(evaluateSilenceGate({ status: 'resolved' }).kind).toBe('silent')
    expect(evaluateSilenceGate({ status: 'waiting' }).kind).toBe('silent')
    expect(evaluateSilenceGate({ status: 'bot' }).kind).toBe('proceed')
  })
  test('a missing document or a statusless one proceeds', () => {
    expect(evaluateSilenceGate(undefined).kind).toBe('proceed')
    expect(evaluateSilenceGate({}).kind).toBe('proceed')
  })
  test('the reopen puts the conversation back into bot status', () => {
    // autoClosedAt is only ever written by the sweep, so its presence is proof we closed it.
    const gate = evaluateSilenceGate({ status: 'resolved', autoClosedAt: new Date() })
    expect(gate.kind === 'reopen' && gate.update.status).toBe('bot')
  })
})
