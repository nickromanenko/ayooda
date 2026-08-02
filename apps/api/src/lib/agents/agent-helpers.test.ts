import { describe, expect, test } from 'bun:test'
import { agentNamespace, resolveAgentDoc, agentDeleteGuard } from './agent-helpers'

describe('agentNamespace', () => {
  test('builds a per-agent namespace', () => {
    expect(agentNamespace('WS1', 'AG1')).toBe('ws_WS1_ag_AG1')
  })
})

describe('resolveAgentDoc', () => {
  const byId = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]])
  const def = { id: 'a' }
  test('returns the agent for an explicit id', () => {
    expect(resolveAgentDoc('b', byId, def)).toEqual({ id: 'b' })
  })
  test('falls back to default when id is missing', () => {
    expect(resolveAgentDoc(undefined, byId, def)).toEqual({ id: 'a' })
  })
  test('falls back to default when the id is unknown', () => {
    expect(resolveAgentDoc('zzz', byId, def)).toEqual({ id: 'a' })
  })
})

describe('agentDeleteGuard', () => {
  test('blocks the default agent (400)', () => {
    expect(agentDeleteGuard({ isDefault: true, isLast: false, attachedChannels: [] })).toEqual({ ok: false, status: 400, error: 'Cannot delete the default agent. Set another agent as default first.' })
  })
  test('blocks the last agent (400)', () => {
    expect(agentDeleteGuard({ isDefault: false, isLast: true, attachedChannels: [] })).toEqual({ ok: false, status: 400, error: 'Cannot delete the only agent.' })
  })
  test('blocks when channels are attached (409)', () => {
    const r = agentDeleteGuard({ isDefault: false, isLast: false, attachedChannels: ['Website', 'Telegram'] })
    expect(r).toEqual({ ok: false, status: 409, error: 'Reassign these channels to another agent first: Website, Telegram' })
  })
  test('allows an otherwise-deletable agent', () => {
    expect(agentDeleteGuard({ isDefault: false, isLast: false, attachedChannels: [] })).toEqual({ ok: true })
  })
})
