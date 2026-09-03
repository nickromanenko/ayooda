import { Hono } from 'hono'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '../lib/firebase-admin'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { elapsedMs } from '../lib/analytics/timing'
import { recordChannelReliability, safeReliabilityDetail } from '../lib/channels/reliability'
import { inboxCustomerIdentity, matchesInboxSearch } from '../lib/inbox'
import { createSupportTicket } from '../lib/ticketing/service'

const conversations = new Hono<{ Variables: AuthVariables }>()

type ConversationRow = Parameters<typeof matchesInboxSearch>[0] & {
  id: string
  status?: string
  createdAt?: unknown
  updatedAt?: unknown
  lastMessage?: string
}

conversations.use('*', requireAuth)

/** GET /conversations — list conversations, optionally filtered by status */
conversations.get('/', async (c) => {
  const workspaceId = c.get('workspaceId')
  const status = c.req.query('status') // 'bot' | 'human' | 'resolved' | undefined
  const search = c.req.query('search')?.trim() ?? ''

  if (search) {
    const snap = await adminDb
      .collection(`workspaces/${workspaceId}/conversations`)
      .orderBy('updatedAt', 'desc')
      .limit(250)
      .get()
    return c.json(snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ConversationRow))
      .filter((row) => (!status || row.status === status) && matchesInboxSearch(row, search))
      .slice(0, 50))
  }

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

/** GET /conversations/operators — safe teammate identities for Inbox assignment. */
conversations.get('/operators', async (c) => {
  const workspaceId = c.get('workspaceId')
  const snap = await adminDb.collection('users').where('workspaceId', '==', workspaceId).get()
  const operators = snap.docs.map((d) => {
    const data = d.data()
    return { uid: d.id, displayName: data.displayName ?? '', email: data.email ?? '', role: data.role ?? 'member' }
  }).sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email))
  return c.json({ operators })
})

/** GET /conversations/:id — load one conversation for direct Inbox links. */
conversations.get('/:id', async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/conversations/${c.req.param('id')}`)
  const snap = await ref.get()
  if (!snap.exists) return c.json({ error: 'Conversation not found' }, 404)
  return c.json({ id: snap.id, ...snap.data() })
})

/** POST /conversations/:id/read — queue-level read state shared by operators. */
conversations.post('/:id/read', async (c) => {
  const ref = adminDb.doc(`workspaces/${c.get('workspaceId')}/conversations/${c.req.param('id')}`)
  if (!(await ref.get()).exists) return c.json({ error: 'Conversation not found' }, 404)
  await ref.update({ unread: false, readAt: FieldValue.serverTimestamp(), readBy: c.get('uid') })
  return c.json({ ok: true })
})

/** PUT /conversations/:id/assignee { uid: string | null } */
conversations.put('/:id/assignee', async (c) => {
  const workspaceId = c.get('workspaceId')
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${c.req.param('id')}`)
  const convSnap = await convRef.get()
  if (!convSnap.exists) return c.json({ error: 'Conversation not found' }, 404)
  if (convSnap.data()?.status === 'resolved') return c.json({ error: 'Reopen the conversation before assigning it.' }, 409)

  const body = await c.req.json<{ uid?: string | null }>().catch(() => ({} as { uid?: string | null }))
  const uid = typeof body.uid === 'string' && body.uid.trim() ? body.uid.trim() : null
  if (uid) {
    const user = await adminDb.doc(`users/${uid}`).get()
    if (!user.exists || user.data()?.workspaceId !== workspaceId) return c.json({ error: 'Teammate not found' }, 404)
  }

  await convRef.update({
    operatorId: uid,
    status: uid ? 'human' : 'waiting',
    ...(uid ? { hadTakeover: true } : {}),
    autoClosedAt: FieldValue.delete(),
    resolvedAt: FieldValue.delete(),
    resolutionMs: FieldValue.delete(),
    unread: false,
    readAt: FieldValue.serverTimestamp(),
    readBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return c.json({ ok: true })
})

/** GET /conversations/:id/context — customer identity and conversation history. */
conversations.get('/:id/context', async (c) => {
  const workspaceId = c.get('workspaceId')
  const current = await adminDb.doc(`workspaces/${workspaceId}/conversations/${c.req.param('id')}`).get()
  if (!current.exists) return c.json({ error: 'Conversation not found' }, 404)
  const data = current.data()!
  const related = await adminDb.collection(`workspaces/${workspaceId}/conversations`)
    .where('visitorId', '==', data.visitorId)
    .limit(200)
    .get()
  const time = (value: unknown) => {
    if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
    return 0
  }
  const rows = related.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationRow))
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
  return c.json({
    customer: inboxCustomerIdentity(data),
    channelType: data.channelType ?? null,
    conversationCount: rows.length,
    truncated: rows.length === 200,
    firstSeenAt: rows.reduce<unknown>((earliest, row) => !earliest || time(row.createdAt) < time(earliest) ? row.createdAt : earliest, null),
    lastSeenAt: rows[0]?.updatedAt ?? null,
    recentConversations: rows.slice(0, 8).map((row) => ({
      id: row.id, status: row.status, lastMessage: row.lastMessage ?? '', updatedAt: row.updatedAt ?? null,
    })),
  })
})

/** POST /conversations/:id/notes — internal-only teammate note. */
conversations.post('/:id/notes', async (c) => {
  const workspaceId = c.get('workspaceId')
  const conversationId = c.req.param('id')
  const convRef = adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`)
  if (!(await convRef.get()).exists) return c.json({ error: 'Conversation not found' }, 404)
  const body = await c.req.json<{ content?: string }>().catch(() => ({} as { content?: string }))
  const content = body.content?.trim() ?? ''
  if (!content) return c.json({ error: 'Note content is required' }, 400)
  if (content.length > 2_000) return c.json({ error: 'Notes can be up to 2,000 characters.' }, 400)
  const author = await adminDb.doc(`users/${c.get('uid')}`).get()
  const authorData = author.data() ?? {}
  const note = await convRef.collection('notes').add({
    content,
    authorId: c.get('uid'),
    authorName: authorData.displayName || authorData.email || 'Teammate',
    createdAt: FieldValue.serverTimestamp(),
  })
  return c.json({ id: note.id }, 201)
})

/** POST /conversations/:id/ticket — operator creates one durable ticket from this conversation. */
conversations.post('/:id/ticket', async (c) => {
  const workspaceId = c.get('workspaceId')
  const conversationId = c.req.param('id')
  const conversation = await adminDb.doc(`workspaces/${workspaceId}/conversations/${conversationId}`).get()
  if (!conversation.exists) return c.json({ error: 'Conversation not found' }, 404)
  if (conversation.data()?.status === 'resolved') return c.json({ error: 'Reopen the conversation before creating a ticket.' }, 409)
  const agentId = conversation.data()?.agentId
  if (typeof agentId !== 'string' || !agentId) return c.json({ error: 'This conversation has no agent.' }, 409)
  try {
    const result = await createSupportTicket({ workspaceId, agentId, conversationId, submission: await c.req.json().catch(() => null), createdBy: 'operator' })
    return c.json(result, result.created ? 201 : 200)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Ticket could not be created.' }, 400)
  }
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
    unread: false,
    readAt: FieldValue.serverTimestamp(),
    readBy: c.get('uid'),
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
    lastMessageRole: 'operator',
    unread: false,
    readAt: FieldValue.serverTimestamp(),
    readBy: uid,
  })

  await adminDb
    .doc(`workspaces/${workspaceId}`)
    .update({ 'usage.messageCount': FieldValue.increment(1) })

  // If this is a Telegram conversation, mirror the operator reply into the chat.
  const conv = convSnap.data()!
  if (conv.channelType === 'telegram' && typeof conv.telegramChatId === 'number') {
    const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
    try {
      const channelSnap = channelId
        ? await adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`).get()
        : null
      const enc = channelSnap?.data()?.botTokenEnc as string | undefined
      if (enc) {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendMessage } = await import('../lib/telegram/client')
        await sendMessage(decryptSecret(enc), conv.telegramChatId, body.content.trim())
        await recordChannelReliability({ workspaceId, channelId, channelType: 'telegram', direction: 'outbound', outcome: 'success', stage: 'operator_reply', conversationId: convId })
      }
    } catch (err) {
      console.warn('[conversations] telegram operator delivery failed:', err)
      if (channelId) await recordChannelReliability({ workspaceId, channelId, channelType: 'telegram', direction: 'outbound', outcome: 'failure', stage: 'operator_reply', detail: safeReliabilityDetail(err), conversationId: convId })
    }
  }

  // If this is an email conversation, mirror the operator reply via Resend.
  if (conv.channelType === 'email' && typeof conv.emailReplyTo === 'string') {
    const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
    try {
      const channelSnap = channelId
        ? await adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`).get()
        : null
      const enc = channelSnap?.data()?.resendApiKeyEnc as string | undefined
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
        await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'success', stage: 'operator_reply', conversationId: convId })
      }
    } catch (err) {
      console.warn('[conversations] email operator delivery failed:', err)
      if (channelId) await recordChannelReliability({ workspaceId, channelId, channelType: 'email', direction: 'outbound', outcome: 'failure', stage: 'operator_reply', detail: safeReliabilityDetail(err), conversationId: convId })
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
        await recordChannelReliability({ workspaceId, channelId, channelType: 'slack', direction: 'outbound', outcome: 'success', stage: 'operator_reply', conversationId: convId })
      }
    } catch (err) {
      console.warn('[conversations] Slack operator delivery failed:', err)
      const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
      if (channelId) await recordChannelReliability({ workspaceId, channelId, channelType: 'slack', direction: 'outbound', outcome: 'failure', stage: 'operator_reply', detail: safeReliabilityDetail(err), conversationId: convId })
    }
  }

  // SMS replies use the exact Twilio channel that received the conversation.
  if (conv.channelType === 'sms' && typeof conv.smsFrom === 'string' && typeof conv.smsTo === 'string') {
    try {
      const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
      const channelSnap = channelId
        ? await adminDb.doc(`workspaces/${workspaceId}/channels/${channelId}`).get()
        : null
      const channel = channelSnap?.data()
      const encrypted = channel?.twilioAuthTokenEnc as string | undefined
      if (encrypted && typeof channel?.twilio?.accountSid === 'string' && typeof channel.twilio.fromNumber === 'string') {
        const { decryptSecret } = await import('../lib/crypto')
        const { sendSms } = await import('../lib/sms/client')
        await sendSms(channel.twilio.accountSid, decryptSecret(encrypted), channel.twilio.fromNumber, conv.smsFrom, body.content.trim())
        await recordChannelReliability({ workspaceId, channelId, channelType: 'sms', direction: 'outbound', outcome: 'success', stage: 'operator_reply', conversationId: convId })
      }
    } catch (err) {
      console.warn('[conversations] SMS operator delivery failed:', err)
      const channelId = typeof conv.channelId === 'string' ? conv.channelId : ''
      if (channelId) await recordChannelReliability({ workspaceId, channelId, channelType: 'sms', direction: 'outbound', outcome: 'failure', stage: 'operator_reply', detail: safeReliabilityDetail(err), conversationId: convId })
    }
  }

  return c.json({ messageId: messageRef.id }, 201)
})

export default conversations
