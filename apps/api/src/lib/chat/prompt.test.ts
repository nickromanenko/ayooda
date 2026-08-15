import { describe, expect, test } from 'bun:test'
import { buildChatParams } from './prompt'

const base = {
  systemPrompt: 'You are helpful.',
  contextBlocks: [] as string[],
  skillBlocks: [] as string[],
  history: [] as Array<{ role: string; content: string }>,
  message: 'hi',
  apiKey: 'k',
  model: 'google/gemini-2.5-flash',
}

describe('buildChatParams', () => {
  test('leaves the system prompt untouched when there is no context', () => {
    expect(buildChatParams(base).systemPrompt).toBe('You are helpful.')
  })

  test('appends knowledge and skill blocks into one context section', () => {
    const p = buildChatParams({ ...base, contextBlocks: ['doc text'], skillBlocks: ['memory text'] })
    expect(p.systemPrompt).toContain('You are helpful.')
    expect(p.systemPrompt).toContain('doc text')
    expect(p.systemPrompt).toContain('memory text')
    // One section, not two — knowledge context and skill context share a block.
    expect(p.systemPrompt.match(/Use the following knowledge base context/g)).toHaveLength(1)
  })

  test('knowledge blocks come before skill blocks', () => {
    const p = buildChatParams({ ...base, contextBlocks: ['AAA'], skillBlocks: ['BBB'] })
    expect(p.systemPrompt.indexOf('AAA')).toBeLessThan(p.systemPrompt.indexOf('BBB'))
  })

  test('drops the final history entry and appends the current message', () => {
    // prepareTurn persists the user message BEFORE reading history, so the last
    // history row is the current message — including it would duplicate it.
    const p = buildChatParams({
      ...base,
      history: [
        { role: 'user', content: 'older question' },
        { role: 'assistant', content: 'older answer' },
        { role: 'user', content: 'hi' },
      ],
      message: 'hi',
    })
    expect(p.messages).toEqual([
      { role: 'user', content: 'older question' },
      { role: 'assistant', content: 'older answer' },
      { role: 'user', content: 'hi' },
    ])
  })

  test('maps any non-user role to assistant', () => {
    const p = buildChatParams({ ...base, history: [{ role: 'operator', content: 'from a human' }, { role: 'user', content: 'hi' }] })
    expect(p.messages[0]).toEqual({ role: 'assistant', content: 'from a human' })
  })

  test('passes model and apiKey through', () => {
    const p = buildChatParams({ ...base, model: 'openai/gpt-5', apiKey: 'secret' })
    expect(p.model).toBe('openai/gpt-5')
    expect(p.apiKey).toBe('secret')
  })
})
