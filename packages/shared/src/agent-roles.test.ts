import { describe, expect, test } from 'bun:test'
import { AGENT_ROLES, agentRole, isAgentRoleId, DEFAULT_AGENT_ROLE_ID } from './agent-roles'
import { validateAgentImage, MAX_AGENT_IMAGE_BYTES } from './index'

describe('agent role catalogue', () => {
  test('every role has a unique id, a label, a description and a seed prompt', () => {
    const ids = AGENT_ROLES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(1)
    for (const r of AGENT_ROLES) {
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.description.length).toBeGreaterThan(0)
      // The prompt is the whole reason this field exists — a role that seeds
      // nothing is decoration, so hold every role to a real prompt.
      expect(r.systemPrompt.trim().length).toBeGreaterThan(40)
    }
  })

  test('roles seed distinct prompts', () => {
    const prompts = AGENT_ROLES.map((r) => r.systemPrompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })

  test('the default role id resolves', () => {
    expect(agentRole(DEFAULT_AGENT_ROLE_ID)).toBeDefined()
  })

  test('agentRole and isAgentRoleId resolve known ids only', () => {
    expect(agentRole('support')?.id).toBe('support')
    expect(agentRole('nope')).toBeUndefined()
    expect(isAgentRoleId('sales')).toBe(true)
    expect(isAgentRoleId('wizard')).toBe(false)
  })
})

describe('validateAgentImage', () => {
  test('accepts png, jpg, jpeg and webp under the cap', () => {
    for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'LOGO.PNG']) {
      expect(validateAgentImage(name, 1024)).toEqual({ ok: true })
    }
  })

  test('rejects non-image extensions', () => {
    expect(validateAgentImage('logo.svg', 1024).ok).toBe(false)
    expect(validateAgentImage('logo.pdf', 1024).ok).toBe(false)
    expect(validateAgentImage('logo', 1024).ok).toBe(false)
  })

  test('rejects filenames with path separators or dot-dot', () => {
    // The filename becomes part of a Storage object key.
    expect(validateAgentImage('../logo.png', 1024).ok).toBe(false)
    expect(validateAgentImage('a/b.png', 1024).ok).toBe(false)
    expect(validateAgentImage('a\\b.png', 1024).ok).toBe(false)
  })

  test('enforces the size cap at the boundary', () => {
    expect(validateAgentImage('logo.png', MAX_AGENT_IMAGE_BYTES)).toEqual({ ok: true })
    expect(validateAgentImage('logo.png', MAX_AGENT_IMAGE_BYTES + 1).ok).toBe(false)
  })

  test('rejects an empty file', () => {
    expect(validateAgentImage('logo.png', 0).ok).toBe(false)
  })
})
