/**
 * Public widget routes — no auth required.
 * These are called directly from embedded scripts on customer websites.
 *
 * GET  /widget/config/:channelId   — widget appearance + agent info
 * POST /widget/chat                — RAG chat: embed → retrieve → generate → save
 */

import { Hono } from 'hono'
import { FieldValue } from 'firebase-admin/firestore'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { adminDb } from '../lib/firebase-admin'
import { embedText } from '../lib/gemini'
import { getLangfuse } from '../lib/langfuse'
import { namespaceFor } from '../lib/pinecone'

const widget = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a channel doc by its stored `id` field (collection group query). */
async function findChannel(channelId: string) {
  const snap = await adminDb
    .collectionGroup('channels')
    .where('id', '==', channelId)
    .limit(1)
    .get()
  if (snap.empty) return null
  return snap.docs[0]
}

// ---------------------------------------------------------------------------
// GET /widget/config/:channelId
// ---------------------------------------------------------------------------

widget.get('/config/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Channel not found' }, 404)

  const data = channelDoc.data()
  return c.json({
    agentName: data.config.agentName,
    agentPhotoURL: data.config.agentPhotoURL ?? null,
    widgetColor: data.config.widgetColor,
    widgetPosition: data.config.widgetPosition,
    welcomeMessage: data.config.welcomeMessage,
  })
})

// ---------------------------------------------------------------------------
// POST /widget/chat
// ---------------------------------------------------------------------------

interface ChatBody {
  channelId: string
  conversationId: string
  message: string
  visitorId: string
}

widget.post('/chat', async (c) => {
  const body = await c.req.json<ChatBody>()
  const { channelId, conversationId, message, visitorId } = body

  if (!channelId || !conversationId || !message?.trim() || !visitorId) {
    return c.json({ error: 'channelId, conversationId, message, and visitorId are required' }, 400)
  }

  // 1. Look up channel → get workspaceId + agent config
  const channelDoc = await findChannel(channelId)
  if (!channelDoc) return c.json({ error: 'Channel not found' }, 404)

  const workspaceId: string = channelDoc.data().workspaceId
  const workspaceSnap = await adminDb.doc(`workspaces/${workspaceId}`).get()
  if (!workspaceSnap.exists) return c.json({ error: 'Workspace not found' }, 404)

  const workspaceRef = adminDb.doc(`workspaces/${workspaceId}`)

  const workspaceData = workspaceSnap.data()!
  const agent = workspaceData.agent
  const systemPrompt: string = agent.systemPrompt
  const llmModel: string = agent.llmModel ?? 'gemini-2.5-flash'

  const trace = getLangfuse().trace({
    name: 'widget-chat',
    sessionId: conversationId,
    userId: visitorId,
    input: { message: message.trim() },
    metadata: { workspaceId, channelId, llmModel },
  })

  // 2. Get or create conversation
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) {
    await convRef.set({
      channelId,
      visitorId,
      status: 'bot',
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: message.trim(),
    })

    await workspaceRef.update({ 'usage.conversationCount': FieldValue.increment(1) })
  }

  // 3. Save user message
  const messagesRef = convRef.collection('messages')
  await messagesRef.add({
    role: 'user',
    content: message.trim(),
    createdAt: FieldValue.serverTimestamp(),
  })

  // 4. Fetch conversation history (last 10 messages for context window)
  const historySnap = await messagesRef.orderBy('createdAt', 'asc').limitToLast(10).get()
  const history = historySnap.docs.map((d) => d.data() as { role: string; content: string })

  // 5. Embed user message + query Pinecone
  let contextBlocks: string[] = []
  let sources: Array<{ docId: string; source: string; score: number }> = []

  try {
    const queryEmbedding = await embedText(message.trim(), trace)
    const retrievalSpan = trace.span({
      name: 'pinecone-query',
      input: { topK: 5 },
    })
    const ns = namespaceFor(workspaceId)
    const results = await ns.query({ vector: queryEmbedding, topK: 5, includeMetadata: true })
    retrievalSpan.end({ output: { matches: results.matches?.length ?? 0 } })

    sources = (results.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.6)
      .map((m) => ({
        docId: (m.metadata?.docId as string) ?? '',
        source: (m.metadata?.source as string) ?? '',
        score: m.score ?? 0,
      }))

    contextBlocks = (results.matches ?? [])
      .filter((m) => (m.score ?? 0) > 0.6)
      .map((m) => (m.metadata?.text as string) ?? '')
      .filter(Boolean)
  } catch (err) {
    // RAG failure is non-fatal — fall back to no context
    console.warn('[widget/chat] RAG retrieval failed:', err)
  }

  // 6. Build prompt
  const contextSection =
    contextBlocks.length > 0
      ? `\n\nUse the following knowledge base context to inform your answer:\n---\n${contextBlocks.join('\n\n')}\n---`
      : ''

  const fullSystemPrompt = systemPrompt + contextSection

  // Build Gemini contents array from history
  const contents = history.slice(0, -1).map((msg) => ({
    role: msg.role === 'user' ? 'user' : ('model' as 'user' | 'model'),
    parts: [{ text: msg.content }],
  }))
  // Add current user message
  contents.push({ role: 'user', parts: [{ text: message.trim() }] })

  // 7. Call Gemini
  let reply = ''
  let promptTokens = 0
  let completionTokens = 0
  const generation = trace.generation({
    name: 'gemini-chat',
    model: llmModel,
    input: { system: fullSystemPrompt, messages: contents },
  })
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: llmModel,
      systemInstruction: fullSystemPrompt,
    })
    const result = await model.generateContent({ contents })
    reply = result.response.text().trim()
    promptTokens = result.response.usageMetadata?.promptTokenCount ?? 0
    completionTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0
    generation.end({
      output: reply,
      usage: {
        input: promptTokens,
        output: completionTokens,
        total: promptTokens + completionTokens,
      },
    })
  } catch (err) {
    console.error('[widget/chat] Gemini call failed:', err)
    generation.end({
      level: 'ERROR',
      statusMessage: err instanceof Error ? err.message : String(err),
    })
    trace.update({ output: { error: 'gemini_failed' } })
    return c.json({ error: 'Failed to generate response' }, 502)
  }

  // 8. Save assistant message

  await messagesRef.add({
    role: 'assistant',
    content: reply,
    createdAt: FieldValue.serverTimestamp(),
    metadata: { sources, llmModel, promptTokens, completionTokens },
  })

  // 9. Update conversation
  await convRef.update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessage: reply.slice(0, 200),
  })

  await workspaceRef.update({
    'usage.messageCount': FieldValue.increment(2), // user + assistant
    'usage.tokenCount': FieldValue.increment(promptTokens + completionTokens),
  })

  trace.update({ output: { message: reply, sources } })

  return c.json({ conversationId, message: reply, sources })
})

export default widget
