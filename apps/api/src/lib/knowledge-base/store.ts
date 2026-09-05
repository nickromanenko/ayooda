import type { KnowledgeBaseArticle } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'
import { serializeKnowledgeBaseArticle } from './serialize'

const CACHE_MS = 60_000
let cache: { expiresAt: number; articles: KnowledgeBaseArticle[] } | null = null
let pending: Promise<KnowledgeBaseArticle[]> | null = null

/** Product help is global and changes only when the Markdown importer runs. */
export async function loadPublishedKnowledgeBaseArticles(): Promise<KnowledgeBaseArticle[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.articles
  if (pending) return pending

  pending = adminDb.collection('knowledgeBaseArticles').where('status', '==', 'published').get()
    .then((snapshot) => snapshot.docs
      .map((doc) => serializeKnowledgeBaseArticle(doc.id, doc.data()))
      .sort((a, b) => a.title.localeCompare(b.title)))
    .then((articles) => {
      cache = { articles, expiresAt: Date.now() + CACHE_MS }
      return articles
    })
    .finally(() => { pending = null })
  return pending
}
