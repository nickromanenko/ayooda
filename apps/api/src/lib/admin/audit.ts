import type { AdminAuditEvent } from '@ayooda/shared'
import { adminDb } from '../firebase-admin'

export type AdminAuditInput = Omit<AdminAuditEvent, 'id' | 'createdAt'>

export async function writeAdminAuditEvent(event: AdminAuditInput): Promise<string> {
  const ref = adminDb.collection('adminAuditLogs').doc()
  await ref.set({ ...event, createdAt: new Date() })
  return ref.id
}

export async function tryWriteAdminAuditEvent(event: AdminAuditInput): Promise<void> {
  try {
    await writeAdminAuditEvent(event)
  } catch (error) {
    console.error('[admin/audit] failed to write audit event', { action: event.action, targetId: event.targetId, error })
  }
}
