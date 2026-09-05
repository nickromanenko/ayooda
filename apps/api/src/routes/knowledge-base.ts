import { Hono } from 'hono'
import { loadPublishedKnowledgeBaseArticles } from '../lib/knowledge-base/store'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { canReadKnowledgeBaseArticle } from '../lib/knowledge-base/visibility'

const knowledgeBase = new Hono<{ Variables: AuthVariables }>()
knowledgeBase.use('*', requireAuth)

knowledgeBase.get('/', async (c) => {
  const articles = (await loadPublishedKnowledgeBaseArticles()).filter((article) => canReadKnowledgeBaseArticle(article.roles, c.get('platformRole')))
  c.header('Cache-Control', 'private, no-store')
  return c.json({ articles })
})

knowledgeBase.get('/context', async (c) => {
  const route = c.req.query('route')?.trim()
  if (!route || (!route.startsWith('/dashboard') && !route.startsWith('/admin'))) return c.json({ error: 'A dashboard or admin route is required.' }, 400)
  const article = (await loadPublishedKnowledgeBaseArticles()).find((candidate) => candidate.route === route && canReadKnowledgeBaseArticle(candidate.roles, c.get('platformRole')))
  if (!article) return c.json({ error: 'Help article not found.' }, 404)
  c.header('Cache-Control', 'private, no-store')
  return c.json(article)
})

knowledgeBase.get('/:slug', async (c) => {
  const article = (await loadPublishedKnowledgeBaseArticles()).find((candidate) => candidate.slug === c.req.param('slug') && canReadKnowledgeBaseArticle(candidate.roles, c.get('platformRole')))
  if (!article) return c.json({ error: 'Help article not found.' }, 404)
  c.header('Cache-Control', 'private, no-store')
  return c.json(article)
})

export default knowledgeBase
