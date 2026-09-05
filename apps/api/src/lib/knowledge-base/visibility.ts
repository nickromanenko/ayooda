import type { KnowledgeBaseArticleRole, PlatformRole } from '@ayooda/shared'

export function canReadKnowledgeBaseArticle(roles: KnowledgeBaseArticleRole[], platformRole?: PlatformRole): boolean {
  return !roles.includes('admin') || platformRole === 'admin'
}
