import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin'
import { Sidebar } from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('__session')?.value

  if (!sessionCookie) redirect('/login')

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true)
    const db = getAdminDb()

    const userSnap = await db.doc(`users/${decoded.uid}`).get()
    if (!userSnap.exists) redirect('/login')

    const { workspaceId } = userSnap.data()!
    const workspaceSnap = await db.doc(`workspaces/${workspaceId}`).get()

    if (!workspaceSnap.data()?.onboardingComplete) redirect('/onboarding')
  } catch {
    redirect('/login')
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto bg-zinc-50 p-6">{children}</main>
      </div>
    </div>
  )
}
