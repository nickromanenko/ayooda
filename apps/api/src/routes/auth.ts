import { Hono } from 'hono'
import { adminAuth, adminDb } from '../lib/firebase-admin'
import { TRIAL_DAYS } from '@ayooda/shared'

const auth = new Hono()

/**
 * POST /auth/verify
 * Called by the frontend after Firebase login.
 * Creates the user document and workspace on first sign-in (idempotent).
 */
auth.post('/verify', async (c) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const idToken = authorization.slice(7)

  let decodedToken
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken, true)
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }

  const { uid, email, name, picture } = decodedToken

  // Check if user already exists
  const userRef = adminDb.doc(`users/${uid}`)
  const userSnap = await userRef.get()

  if (userSnap.exists) {
    const userData = userSnap.data()!
    if (userData.accessStatus === 'disabled') return c.json({ error: 'Account disabled' }, 403)
    const normalized = {
      email: email ?? userData.email ?? '',
      emailLower: (email ?? userData.email ?? '').trim().toLowerCase(),
      displayName: name ?? userData.displayName ?? '',
      displayNameLower: (name ?? userData.displayName ?? '').trim().toLowerCase(),
      photoURL: picture ?? userData.photoURL ?? null,
      accessStatus: 'active',
      updatedAt: new Date(),
    }
    await userRef.set(normalized, { merge: true })
    return c.json({ workspaceId: userData.workspaceId })
  }

  // Auto-join: if this email was invited, attach as a member instead of creating a workspace.
  const emailLower = (email ?? '').trim().toLowerCase()
  if (emailLower) {
    const inviteRef = adminDb.doc(`pendingInvites/${emailLower}`)
    const inviteSnap = await inviteRef.get()
    if (inviteSnap.exists && decodedToken.email_verified === true) {
      const invite = inviteSnap.data() as { workspaceId: string }
      if (typeof invite.workspaceId === 'string' && invite.workspaceId.length > 0) {
        const batch = adminDb.batch()
        batch.set(userRef, {
          email: email ?? '',
          displayName: name ?? '',
          photoURL: picture ?? null,
          workspaceId: invite.workspaceId,
          role: 'member',
          emailLower,
          displayNameLower: (name ?? '').trim().toLowerCase(),
          accessStatus: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        batch.delete(inviteRef)
        await batch.commit()
        return c.json({ workspaceId: invite.workspaceId })
      }
    }
  }

  // First login — create user + workspace atomically
  const workspaceRef = adminDb.collection('workspaces').doc()
  const workspaceId = workspaceRef.id
  const now = new Date()

  const defaultAgentRef = workspaceRef.collection('agents').doc()
  const defaultAgent = {
    name: 'Support Agent',
    photoURL: null,
    description: '',
    systemPrompt: 'You are a helpful customer support agent. Answer questions based on the provided context.',
    llmModel: 'google/gemini-2.5-flash',
    knowledgeNamespace: `ws_${workspaceId}`,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }

  const batch = adminDb.batch()

  batch.set(userRef, {
    email: email ?? '',
    displayName: name ?? '',
    photoURL: picture ?? null,
    workspaceId,
    role: 'owner',
    emailLower,
    displayNameLower: (name ?? '').trim().toLowerCase(),
    accessStatus: 'active',
    createdAt: now,
    updatedAt: now,
  })

  batch.set(workspaceRef, {
    name: name ? `${name}'s workspace` : 'My workspace',
    nameLower: (name ? `${name}'s workspace` : 'My workspace').toLowerCase(),
    ownerId: uid,
    createdAt: now,
    onboardingComplete: false,
    agent: {
      name: 'Support Agent',
      photoURL: null,
      description: '',
      systemPrompt: 'You are a helpful customer support agent. Answer questions based on the provided context.',
      llmModel: 'google/gemini-2.5-flash',
    },
    usage: {
      conversationCount: 0,
      messageCount: 0,
      tokenCount: 0,
      periodConversationCount: 0,
      periodStart: now,
    },
    subscription: {
      status: 'trialing',
      tier: null,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  })

  batch.set(defaultAgentRef, defaultAgent)

  await batch.commit()

  return c.json({ workspaceId }, 201)
})

export default auth
