import type { KnowledgeBaseArticle } from '@ayooda/shared'

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString()
  }
  return null
}

export function serializeKnowledgeBaseArticle(id: string, data: Record<string, unknown>): KnowledgeBaseArticle {
  return {
    articleId: String(data.articleId ?? id),
    title: String(data.title ?? ''),
    slug: String(data.slug ?? ''),
    category: String(data.category ?? ''),
    route: String(data.route ?? ''),
    roles: Array.isArray(data.roles)
      ? data.roles.filter((role): role is 'owner' | 'member' | 'admin' => role === 'owner' || role === 'member' || role === 'admin')
      : [],
    summary: String(data.summary ?? ''),
    keywords: Array.isArray(data.keywords) ? data.keywords.filter((keyword): keyword is string => typeof keyword === 'string') : [],
    relatedArticleIds: Array.isArray(data.relatedArticleIds) ? data.relatedArticleIds.filter((articleId): articleId is string => typeof articleId === 'string') : [],
    status: data.status === 'draft' || data.status === 'archived' ? data.status : 'published',
    bodyMarkdown: String(data.bodyMarkdown ?? ''),
    sourcePath: String(data.sourcePath ?? ''),
    updatedAt: iso(data.updatedAt),
    publishedAt: iso(data.publishedAt),
  }
}
