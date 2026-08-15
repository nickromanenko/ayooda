import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { getLangfuse } from './lib/langfuse'

const app = new Hono()

app.use('*', logger())

// Widget routes are public (called from customer websites) — allow all origins.
// Must register before the global CORS: preflights are answered by the first matching middleware.
app.use('/widget/*', cors({ origin: '*' }))

app.use('*', cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ ok: true }))

import authRoutes from './routes/auth'
import workspaceRoutes from './routes/workspace'
import userRoutes from './routes/user'
import knowledgeRoutes from './routes/knowledge'
import channelRoutes from './routes/channels'
import conversationRoutes from './routes/conversations'
import widgetRoutes from './routes/widget'
import billingRoutes from './routes/billing'
import telegramRoutes from './routes/telegram'
import teamRoutes from './routes/team'
import toolRoutes from './routes/tools'
import agentRoutes from './routes/agents'
import workflowRoutes from './routes/workflows'
import skillRoutes from './routes/skills'
import internalRoutes from './routes/internal'
import copilotRoutes from './routes/copilot'

app.route('/auth', authRoutes)
app.route('/workspace', workspaceRoutes)
app.route('/team', teamRoutes)
app.route('/billing', billingRoutes)
app.route('/user', userRoutes)
app.route('/agents/:agentId/knowledge', knowledgeRoutes)
app.route('/channels', channelRoutes)
app.route('/conversations', conversationRoutes)
app.route('/agents', agentRoutes)
app.route('/agents/:agentId/tools', toolRoutes)
app.route('/agents/:agentId/skills', skillRoutes)
app.route('/workflows', workflowRoutes)

app.route('/widget', widgetRoutes)
app.route('/telegram', telegramRoutes)
app.route('/internal', internalRoutes)
app.route('/copilot', copilotRoutes)

const port = parseInt(process.env.PORT ?? '3001')
console.log(`API running on http://localhost:${port}`)

const shutdown = async (signal: string) => {
  console.log(`[shutdown] received ${signal}, flushing Langfuse...`)
  await getLangfuse().shutdownAsync()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default {
  port,
  fetch: app.fetch,
}
