import { FieldPath } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '../lib/firebase-admin'

const PAGE_SIZE = 400
let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
let updated = 0

while (true) {
  let query = adminDb.collection('users').orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.get()
  if (snapshot.empty) break

  const authUsers = await adminAuth.getUsers(snapshot.docs.map((doc) => ({ uid: doc.id })))
  const disabledByUid = new Map(authUsers.users.map((user) => [user.uid, user.disabled]))
  const batch = adminDb.batch()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    batch.set(doc.ref, {
      emailLower: String(data.email ?? '').trim().toLowerCase(),
      displayNameLower: String(data.displayName ?? '').trim().toLowerCase(),
      accessStatus: data.accessStatus === 'disabled' || disabledByUid.get(doc.id) ? 'disabled' : 'active',
      updatedAt: data.updatedAt ?? data.createdAt ?? new Date(),
    }, { merge: true })
    updated += 1
  }
  await batch.commit()
  cursor = snapshot.docs.at(-1)
  if (snapshot.size < PAGE_SIZE) break
}

console.log(`Backfilled admin search and access fields for ${updated} users.`)

let workspaceCursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
let workspaceUpdated = 0
while (true) {
  let query = adminDb.collection('workspaces').orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
  if (workspaceCursor) query = query.startAfter(workspaceCursor)
  const snapshot = await query.get()
  if (snapshot.empty) break
  const batch = adminDb.batch()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    batch.set(doc.ref, {
      nameLower: String(data.name ?? '').trim().toLowerCase(),
      updatedAt: data.updatedAt ?? data.createdAt ?? new Date(),
    }, { merge: true })
    workspaceUpdated += 1
  }
  await batch.commit()
  workspaceCursor = snapshot.docs.at(-1)
  if (snapshot.size < PAGE_SIZE) break
}

console.log(`Backfilled admin search fields for ${workspaceUpdated} workspaces.`)
