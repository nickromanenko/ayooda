import { Hono } from 'hono'
import { loadPublishedKnowledgeBaseArticles } from '../lib/knowledge-base/store'
import { requireAuth, type AuthVariables } from '../middleware/auth'

const knowledgeBase = new Hono<{ Variables: AuthVariables }>()
knowledgeBase.use('*', requireAuth)

knowledgeBase.get('/', async (c) => {
  const articles = await loadPublishedKnowledgeBaseArticles()
  c.header('Cache-Control', 'private, max-age=60')
  return c.json({ articles })
})

knowledgeBase.get('/context', async (c) => {
  const route = c.req.query('route')?.trim()
  if (!route || !route.startsWith('/dashboard')) return c.json({ error: 'A dashboard route is required.' }, 400)
  const article = (await loadPublishedKnowledgeBaseArticles()).find((candidate) => candidate.route === route)
  if (!article) return c.json({ error: 'Help article not found.' }, 404)
  c.header('Cache-Control', 'private, max-age=60')
  return c.json(article)
})

knowledgeBase.get('/:slug', async (c) => {
  const article = (await loadPublishedKnowledgeBaseArticles()).find((candidate) => candidate.slug === c.req.param('slug'))
  if (!article) return c.json({ error: 'Help article not found.' }, 404)
  c.header('Cache-Control', 'private, max-age=60')
  return c.json(article)
})

export default knowledgeBase
