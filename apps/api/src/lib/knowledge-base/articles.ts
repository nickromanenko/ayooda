import { createHash } from 'node:crypto'
import type {
  KnowledgeBaseArticleRole,
  KnowledgeBaseArticleStatus,
} from '@ayooda/shared'

export interface ParsedKnowledgeBaseArticle {
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
  updatedAt: string
  bodyMarkdown: string
  sourcePath: string
  contentHash: string
}

const REQUIRED_FIELDS = [
  'article_id', 'title', 'slug', 'category', 'route', 'roles', 'summary',
  'keywords', 'related_articles', 'status', 'updated_at',
] as const

function parseValue(value: string): string | string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim()
    return body ? body.split(',').map((item) => item.trim()) : []
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
  return trimmed
}

function expectString(metadata: Record<string, string | string[]>, field: string, sourcePath: string): string {
  const value = metadata[field]
  if (typeof value !== 'string' || !value) throw new Error(`${sourcePath}: ${field} must be a non-empty string`)
  return value
}

function expectArray(metadata: Record<string, string | string[]>, field: string, sourcePath: string): string[] {
  const value = metadata[field]
  if (!Array.isArray(value)) throw new Error(`${sourcePath}: ${field} must be an inline array`)
  return value
}

export function parseKnowledgeBaseArticle(markdown: string, sourcePath: string): ParsedKnowledgeBaseArticle {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/)
  if (!match) throw new Error(`${sourcePath}: missing YAML frontmatter or body`)

  const metadata = Object.fromEntries(match[1].split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`${sourcePath}: invalid frontmatter line: ${line}`)
    return [line.slice(0, separator), parseValue(line.slice(separator + 1))]
  }))
  for (const field of REQUIRED_FIELDS) {
    if (metadata[field] === undefined || metadata[field] === '') throw new Error(`${sourcePath}: missing ${field}`)
  }

  const articleId = expectString(metadata, 'article_id', sourcePath)
  const slug = expectString(metadata, 'slug', sourcePath)
  const route = expectString(metadata, 'route', sourcePath)
  const roles = expectArray(metadata, 'roles', sourcePath)
  const keywords = expectArray(metadata, 'keywords', sourcePath)
  const relatedArticleIds = expectArray(metadata, 'related_articles', sourcePath)
  const status = expectString(metadata, 'status', sourcePath)
  const updatedAt = expectString(metadata, 'updated_at', sourcePath)
  const bodyMarkdown = match[2].trim()

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(articleId)) throw new Error(`${sourcePath}: invalid article_id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${sourcePath}: invalid slug`)
  if (!route.startsWith('/dashboard')) throw new Error(`${sourcePath}: route must start with /dashboard`)
  if (!roles.length || roles.some((role) => !['owner', 'member'].includes(role))) throw new Error(`${sourcePath}: invalid roles`)
  if (keywords.length < 2) throw new Error(`${sourcePath}: at least two keywords are required`)
  if (!['draft', 'published', 'archived'].includes(status)) throw new Error(`${sourcePath}: invalid status`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) throw new Error(`${sourcePath}: invalid updated_at`)
  if (!bodyMarkdown.startsWith('# ')) throw new Error(`${sourcePath}: body must start with a level-one heading`)

  const canonical = JSON.stringify({ metadata, bodyMarkdown, sourcePath })
  return {
    articleId,
    title: expectString(metadata, 'title', sourcePath),
    slug,
    category: expectString(metadata, 'category', sourcePath),
    route,
    roles: roles as KnowledgeBaseArticleRole[],
    summary: expectString(metadata, 'summary', sourcePath),
    keywords,
    relatedArticleIds,
    status: status as KnowledgeBaseArticleStatus,
    updatedAt,
    bodyMarkdown,
    sourcePath,
    contentHash: createHash('sha256').update(canonical).digest('hex'),
  }
}

export function validateKnowledgeBaseArticles(articles: ParsedKnowledgeBaseArticle[]): void {
  for (const field of ['articleId', 'slug', 'route'] as const) {
    const seen = new Map<string, string>()
    for (const article of articles) {
      const value = article[field]
      const previous = seen.get(value)
      if (previous) throw new Error(`${article.sourcePath}: duplicate ${field} ${value} (also in ${previous})`)
      seen.set(value, article.sourcePath)
    }
  }

  const ids = new Set(articles.map((article) => article.articleId))
  for (const article of articles) {
    for (const relatedId of article.relatedArticleIds) {
      if (!ids.has(relatedId)) throw new Error(`${article.sourcePath}: unknown related article ${relatedId}`)
      if (relatedId === article.articleId) throw new Error(`${article.sourcePath}: article cannot relate to itself`)
    }
  }
}
