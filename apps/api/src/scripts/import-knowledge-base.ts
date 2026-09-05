import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { parseKnowledgeBaseArticle, validateKnowledgeBaseArticles } from '../lib/knowledge-base/articles'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../../../..')
const articleDirectories = ['dashboard', 'admin']
const dryRun = process.argv.includes('--dry-run')

const articles = (await Promise.all(articleDirectories.map(async (directory) => {
  const articleDirectory = path.join(repositoryRoot, 'docs/knowledge-base', directory)
  const files = (await readdir(articleDirectory)).filter((file) => file.endsWith('.md')).sort()
  return Promise.all(files.map(async (file) => {
    const sourcePath = path.posix.join('docs/knowledge-base', directory, file)
    return parseKnowledgeBaseArticle(await readFile(path.join(articleDirectory, file), 'utf8'), sourcePath)
  }))
}))).flat()
validateKnowledgeBaseArticles(articles)

let created = 0
let updated = 0
let unchanged = 0

for (const article of articles) {
  const ref = adminDb.doc(`knowledgeBaseArticles/${article.articleId}`)
  const existing = dryRun ? null : await ref.get()
  if (existing?.exists && existing.data()?.contentHash === article.contentHash) {
    unchanged += 1
    continue
  }

  if (dryRun) {
    console.log(`[dry-run] upsert ${article.articleId} (${article.route})`)
    continue
  }

  const isNew = !existing?.exists
  const wasPublished = existing?.data()?.status === 'published'
  await ref.set({
    articleId: article.articleId,
    title: article.title,
    slug: article.slug,
    category: article.category,
    route: article.route,
    roles: article.roles,
    summary: article.summary,
    keywords: article.keywords,
    relatedArticleIds: article.relatedArticleIds,
    status: article.status,
    bodyMarkdown: article.bodyMarkdown,
    sourcePath: article.sourcePath,
    sourceUpdatedAt: article.updatedAt,
    contentHash: article.contentHash,
    updatedAt: FieldValue.serverTimestamp(),
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
    ...(article.status === 'published' && !wasPublished ? { publishedAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true })
  if (isNew) created += 1
  else updated += 1
}

if (dryRun) {
  console.log(`Validated ${articles.length} articles. No database writes were made.`)
} else {
  console.log(`Knowledge base synchronized: ${created} created, ${updated} updated, ${unchanged} unchanged.`)
}
