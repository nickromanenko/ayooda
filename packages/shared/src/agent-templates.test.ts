import { describe, expect, test } from 'bun:test'
import { AGENT_TEMPLATES, agentTemplate, isAgentTemplateId } from './agent-templates'
import { isAgentRoleId } from './agent-roles'
import { validateSkillConfig } from './skills'

describe('agent templates', () => {
  test('have unique stable ids and valid reusable configuration', () => {
    expect(new Set(AGENT_TEMPLATES.map((template) => template.id)).size).toBe(AGENT_TEMPLATES.length)
    for (const template of AGENT_TEMPLATES) {
      expect(isAgentRoleId(template.role)).toBe(true)
      expect(template.rules.length).toBeGreaterThan(0)
      expect(template.tests.length).toBeGreaterThan(0)
      expect(new Set(template.rules.map((rule) => rule.id)).size).toBe(template.rules.length)
      expect(new Set(template.tests.map((testCase) => testCase.id)).size).toBe(template.tests.length)
      for (const skill of template.skills) expect(validateSkillConfig(skill.id, skill.config).ok).toBe(true)
    }
  })

  test('resolves only known template ids', () => {
    expect(agentTemplate('support-desk')?.label).toBe('Customer support')
    expect(agentTemplate('missing')).toBeUndefined()
    expect(isAgentTemplateId('sales-concierge')).toBe(true)
    expect(isAgentTemplateId('missing')).toBe(false)
  })
})
