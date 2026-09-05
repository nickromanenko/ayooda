export type KnowledgeBaseArticleStatus = 'draft' | 'published' | 'archived'
export type KnowledgeBaseArticleRole = 'owner' | 'member'

/** Safe article shape returned to authenticated dashboard clients. */
export interface KnowledgeBaseArticle {
  articleId: string
  title: string
  slug: string
  category: string
  route: string
  roles: KnowledgeBaseArticleRole[]
  summary: string
  keywords: string[]
  relatedArticleIds: string[]
  status: KnowledgeBaseArticleStatus
  bodyMarkdown: string
  sourcePath: string
  updatedAt: string | null
  publishedAt: string | null
}

export type KnowledgeBaseArticleSummary = Omit<KnowledgeBaseArticle, 'bodyMarkdown'>
