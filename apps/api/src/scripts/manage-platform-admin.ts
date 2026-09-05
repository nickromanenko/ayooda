import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '../lib/firebase-admin'
import { writeAdminAuditEvent } from '../lib/admin/audit'

async function resolveUid(identifier: string): Promise<{ uid: string; email: string }> {
  try {
    const record = identifier.includes('@')
      ? await adminAuth.getUserByEmail(identifier.trim().toLowerCase())
      : await adminAuth.getUser(identifier.trim())
    return { uid: record.uid, email: record.email ?? '' }
  } catch {
    throw new Error(`No Firebase Authentication user found for "${identifier}".`)
  }
}

async function main() {
  const [action, identifier] = Bun.argv.slice(2).filter((argument) => argument !== '--')
  if ((action !== 'grant' && action !== 'revoke') || !identifier) {
    throw new Error('Usage: manage-platform-admin.ts <grant|revoke> <firebase-email-or-uid>')
  }

  const target = await resolveUid(identifier)
  const ref = adminDb.doc(`users/${target.uid}`)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('The Firebase user does not have an Ayooda user document yet. Ask them to sign in once first.')

  if (action === 'revoke') {
    const admins = await adminDb.collection('users').where('platformRole', '==', 'admin').limit(2).get()
    if (admins.size === 1 && admins.docs[0]?.id === target.uid) {
      throw new Error('Cannot revoke the final platform administrator.')
    }
  }

  await ref.update({
    platformRole: action === 'grant' ? 'admin' : FieldValue.delete(),
    updatedAt: new Date(),
  })
  await writeAdminAuditEvent({
    actorUid: 'system:cli',
    actorEmail: '',
    action: action === 'grant' ? 'platform_role.granted' : 'platform_role.revoked',
    targetType: 'platform_role',
    targetId: target.uid,
    outcome: 'succeeded',
    summary: `${action === 'grant' ? 'Granted' : 'Revoked'} platform administrator access for ${target.email || target.uid}.`,
    metadata: { targetEmail: target.email || null },
  })

  console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} platform administrator access: ${target.email || target.uid} (${target.uid})`)
}

await main()
