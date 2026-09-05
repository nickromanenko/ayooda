import { describe, expect, test } from 'bun:test'
import { parseKnowledgeBaseArticle, validateKnowledgeBaseArticles } from './articles'

const source = `---
article_id: dashboard-overview
title: Dashboard overview
slug: dashboard-overview
category: Dashboard
route: /dashboard
roles: [owner, member]
summary: "Understand the dashboard."
keywords: [overview, metrics]
related_articles: []
status: published
updated_at: 2026-09-05
---

# Dashboard overview

Useful help.`

describe('knowledge-base articles', () => {
  test('parses importer-ready frontmatter and hashes canonical content', () => {
    const article = parseKnowledgeBaseArticle(source, 'overview.md')
    expect(article.articleId).toBe('dashboard-overview')
    expect(article.roles).toEqual(['owner', 'member'])
    expect(article.bodyMarkdown).toContain('Useful help.')
    expect(article.contentHash).toHaveLength(64)
  })

  test('rejects unknown related article IDs', () => {
    const article = parseKnowledgeBaseArticle(source.replace('related_articles: []', 'related_articles: [missing]'), 'overview.md')
    expect(() => validateKnowledgeBaseArticles([article])).toThrow('unknown related article missing')
  })

  test('rejects duplicate routes', () => {
    const first = parseKnowledgeBaseArticle(source, 'overview.md')
    const second = parseKnowledgeBaseArticle(source
      .replace('article_id: dashboard-overview', 'article_id: other')
      .replace('slug: dashboard-overview', 'slug: other'), 'other.md')
    expect(() => validateKnowledgeBaseArticles([first, second])).toThrow('duplicate route /dashboard')
  })

  test('accepts administrator-only help for admin routes', () => {
    const article = parseKnowledgeBaseArticle(source
      .replace('route: /dashboard', 'route: /admin')
      .replace('roles: [owner, member]', 'roles: [admin]'), 'admin.md')
    expect(article.roles).toEqual(['admin'])
    expect(article.route).toBe('/admin')
  })
})
