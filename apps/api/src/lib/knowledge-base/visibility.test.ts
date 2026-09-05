import { describe, expect, test } from 'bun:test'
import { canReadKnowledgeBaseArticle } from './visibility'

describe('knowledge base visibility', () => {
  test('keeps workspace help available to signed-in workspace users', () => {
    expect(canReadKnowledgeBaseArticle(['owner'])).toBe(true)
    expect(canReadKnowledgeBaseArticle(['owner', 'member'])).toBe(true)
  })

  test('keeps platform operations help exclusive to admins', () => {
    expect(canReadKnowledgeBaseArticle(['admin'])).toBe(false)
    expect(canReadKnowledgeBaseArticle(['admin'], 'admin')).toBe(true)
  })
})
