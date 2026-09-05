import { describe, expect, test } from 'bun:test'
import { serializeKnowledgeBaseArticle } from './serialize'

describe('serializeKnowledgeBaseArticle', () => {
  test('preserves supported roles, including platform administrators', () => {
    const article = serializeKnowledgeBaseArticle('article-1', {
      roles: ['owner', 'member', 'admin', 'unknown'],
    })

    expect(article.roles).toEqual(['owner', 'member', 'admin'])
  })
})
