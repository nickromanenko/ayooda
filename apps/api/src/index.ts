import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ ok: true }))

import authRoutes from './routes/auth'
import workspaceRoutes from './routes/workspace'
import knowledgeRoutes from './routes/knowledge'
import channelRoutes from './routes/channels'
import widgetRoutes from './routes/widget'

app.route('/auth', authRoutes)
app.route('/workspace', workspaceRoutes)
app.route('/knowledge', knowledgeRoutes)
app.route('/channels', channelRoutes)

// Widget routes are public (called from customer websites) — allow all origins
app.use('/widget/*', cors({ origin: '*' }))
app.route('/widget', widgetRoutes)

const port = parseInt(process.env.PORT ?? '3001')
console.log(`API running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
