import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { Sidebar } from '@/components/dashboard/Sidebar'
import DashboardSearch from '@/components/dashboard/DashboardSearch'
import DashboardAttention from '@/components/dashboard/DashboardAttention'
import styles from './layout.module.css'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')?.value

  if (!sessionCookie) redirect('/login')

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
    const db = getAdminDb()

    const userSnap = await db.doc(`users/${decoded.uid}`).get()
    if (!userSnap.exists) redirect('/api/session')

    const { workspaceId } = userSnap.data()!
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()

    if (!workspaceSnap.data()?.onboardingComplete) redirect('/onboarding')

    const role = (userSnap.data()!.role as 'owner' | 'member') ?? 'owner'

    // A member granted access to at least one agent needs the Agents entry to
    // reach it; a member with none would only land on an empty list.
    const hasAgentAccess = role === 'owner' || !(await db
      .collection(`workspaces/${workspaceId}/agents`)
      .where('editorUids', 'array-contains', decoded.uid)
      .limit(1)
      .get()).empty

    return (
      <div className={`${styles.shell} dashboard-shell`}>
        <Sidebar role={role} hasAgentAccess={hasAgentAccess} />
        <DashboardSearch role={role} hasAgentAccess={hasAgentAccess} />
        <DashboardAttention role={role} />
        <div className={styles.content}>
          <main className={styles.main}>{children}</main>
        </div>
      </div>
    )
  } catch (err) {
    if (isRedirectError(err)) throw err
    console.error('[dashboard/layout] session verification failed:', err)
    redirect('/api/session')
  }
}
