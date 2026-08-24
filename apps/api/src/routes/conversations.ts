import { Hono } from 'hono'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { elapsedMs } from '../lib/analytics/timing'

const conversations = new Hono<{ Variables: AuthVariables }>()

conversations.use('*', requireAuth)

/** GET /conversations — list conversations, optionally filtered by status */
conversations.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const status = c.req.query('status') // 'bot' | 'human' | 'resolved' | undefined

  let query = adminDb
    .collection(`workspaces/${workspaceId}/conversations`)
    .orderBy('updatedAt', 'desc')
    .limit(50)

  if (status) {
    query = adminDb
      .collection(`workspaces/${workspaceId}/conversations`)
      .where('status', '==', status)
      .orderBy('updatedAt', 'desc')
      .limit(50) as typeof query
  }

  const snap = await query.get()
  return c.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
})

/** GET /conversations/:id/messages — get all messages for a conversation */
conversations.get('/:id/messages', async (c) => {
  const workspaceId = c.get('workspaceId')
  const convId = c.req.param('id')

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${convId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) return c.json({ error: 'Conversation not found' }, 404)

  const messagesSnap = await convRef
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()

  return c.json({
    conversation: { id: convSnap.id, ...convSnap.data() },
    messages: messagesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  })
})

/** POST /conversations/:id/takeover — operator takes over from bot */
conversations.post('/:id/takeover', async (c) => {
  const workspaceId = c.get('workspaceId')
  const uid = c.get('uid')
  const convId = c.req.param('id')

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${convId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) return c.json({ error: 'Conversation not found' }, 404)

  await convRef.update({
    status: 'human',
    operatorId: uid,
    hadTakeover: true,
    ...(typeof convSnap.data()?.escalationReason === 'string' && convSnap.data()!.escalationReason.trim()
      ? {}
      : { escalationReason: 'Manual takeover' }),
    // `autoClosedAt` means "the sweep closed this and no human has touched it since" —
    // prepareTurn reopens such a conversation on the next visitor message. Clearing it
    // here stops the bot answering over an operator who has just taken over.
    autoClosedAt: FieldValue.delete(),
    resolvedAt: FieldValue.delete(),
    resolutionMs: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return c.json({ ok: true })
})

/** POST /conversations/:id/resolve — mark conversation as resolved */
conversations.post('/:id/resolve', async (c) => {
  const workspaceId = c.get('workspaceId')
  const convId = c.req.param('id')

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${convId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) return c.json({ error: 'Conversation not found' }, 404)

  const resolvedAt = new Date()
  const resolutionMs = convSnap.data()?.timingTrackedAt ? elapsedMs(convSnap.data()?.createdAt, resolvedAt) : null

  await convRef.update({
    status: 'resolved',
    operatorId: null,
    pendingPostProcess: true,
    ...(resolutionMs !== null ? { resolvedAt, resolutionMs } : {}),
    // Same invariant as takeover: an operator resolving an already auto-closed
    // conversation is an explicit human decision, so it must not be undone by the
    // next visitor message reopening it.
    autoClosedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return c.json({ ok: true })
})

/** POST /conversations/:id/messages — operator sends a message */
conversations.post('/:id/messages', async (c) => {
  const workspaceId = c.get('workspaceId')
  const uid = c.get('uid')
  const convId = c.req.param('id')
  const body = await c.req.json<{ content: string }>()

  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)

  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${convId}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) return c.json({ error: 'Conversation not found' }, 404)

  const messageRef = await convRef.collection('messages').add({
    role: 'operator',
    content: body.content.trim(),
    operatorId: uid,
    createdAt: FieldValue.serverTimestamp(),
  })

  await convRef.update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessage: body.content.trim().slice(0, 200),
  })

  await adminDb
    .doc(`workspaces/${workspaceId}`)
    .update({ 'usage.messageCount': FieldValue.increment(1) })

  // If this is a Telegram conversation, mirror the operator reply into the chat.
  const conv = convSnap.data()!
  if (conv.channelType === 'telegram' && typeof conv.telegramChatId === 'number') {
    try {
      const chSnap = await adminDb
        .collection(`workspaces/${workspaceId}/channels`)
        .where('type', '==', 'telegram')
        .limit(1)
        .get()
      const enc = chSnap.docs[0]?.data().botTokenEnc as string | undefined
      if (enc) {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendMessage } = await import('../lib/telegram/client')
        await sendMessage(decryptSecret(enc), conv.telegramChatId, body.content.trim())
      }
    } catch (err) {
      console.warn('[conversations] telegram operator delivery failed:', err)
    }
  }

  // If this is an email conversation, mirror the operator reply via Resend.
  if (conv.channelType === 'email' && typeof conv.emailReplyTo === 'string') {
    try {
      const chSnap = await adminDb
        .collection(`workspaces/${workspaceId}/channels`)
        .where('type', '==', 'email')
        .limit(1)
        .get()
      const enc = chSnap.docs[0]?.data().resendApiKeyEnc as string | undefined
      if (enc) {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendEmail } = await import('../lib/email/client')
        const { replySubject } = await import('../lib/email/parse')
        await sendEmail({
          apiKey: decryptSecret(enc),
          from: (conv.emailReplyFrom as string | undefined) ?? '',
          to: conv.emailReplyTo,
          subject: replySubject((conv.emailSubject as string | undefined) ?? ''),
          text: body.content.trim(),
          inReplyTo: conv.emailMessageId as string | undefined,
        })
      }
    } catch (err) {
      console.warn('[conversations] email operator delivery failed:', err)
    }
  }

  // Slack threads stay attached to the exact channel/app that created the conversation.
  if (conv.channelType === 'slack' && typeof conv.slackChannelId === 'string') {
    try {
      const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
      const channelSnap = channelId
        ? await adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`).get()
        : null
      const encrypted = channelSnap?.data()?.slackBotTokenEnc as string | undefined
      if (encrypted) {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendSlackMessage } = await import('../lib/slack/client')
        await sendSlackMessage(
          decryptSecret(encrypted),
          conv.slackChannelId,
          body.content.trim(),
          typeof conv.slackThreadTs === 'string' ? conv.slackThreadTs : undefined,
        )
      }
    } catch (err) {
      console.warn('[conversations] Slack operator delivery failed:', err)
    }
  }

  return c.json({ messageId: messageRef.id }, 201)
})

export default conversations
